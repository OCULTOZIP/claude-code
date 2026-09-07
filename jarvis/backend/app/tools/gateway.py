"""Tool Gateway: o unico caminho ate uma ferramenta.

Implementa as sete etapas da secao 5.3 do projeto tecnico. Nenhum adaptador e chamado
fora daqui. O orquestrador nao importa adaptador nenhum; ele so conhece este objeto.
"""
from __future__ import annotations

import time
import uuid
from collections import deque
from typing import Any, Awaitable, Callable

from ..core.errors import (
    Blocked, ConfirmationDenied, ConfirmationRequired, RateLimited, SchemaViolation, ToolError,
    ToolNotFound,
)
from ..policy.engine import (
    Decision, PolicyEngine, TurnState, canonical, params_hash, render_confirmation,
)
from .registry import Registry, validate

# Pergunta feita ao usuario; devolve o token assinado, ou None se ele cancelou.
ConfirmFn = Callable[[str, str, dict], Awaitable[str | None]]


class Gateway:
    def __init__(self, config, registry: Registry, policy: PolicyEngine, store, adapters: dict):
        self.config = config
        self.registry = registry
        self.policy = policy
        self.store = store
        self._adapters = adapters
        self._calls: dict[str, deque[float]] = {}
        self._done: dict[str, dict] = {}  # idempotencia por call_id

    # ------------------------------------------------------------------
    async def execute(self, name: str, raw_params: dict, turn: TurnState,
                      confirm: ConfirmFn | None = None, call_id: str | None = None,
                      session: str = "local") -> dict:
        call_id = call_id or uuid.uuid4().hex[:12]
        started = time.time()
        decision: Decision | None = None
        contract = None
        confirmed = "n/a"

        try:
            # 1. Existencia, versao e habilitacao ------------------------------
            if not self.registry.has(name):
                raise ToolNotFound(name)
            if not self.registry.is_enabled(name):
                raise Blocked(f"A ferramenta {name} esta desligada no painel.")
            contract = self.registry.get(name)
            if contract.risk_level >= 4:
                raise Blocked(f"{name} e nivel 4 e nao possui implementacao.")

            # Idempotencia: o mesmo call_id nunca executa duas vezes.
            if call_id in self._done:
                return self._done[call_id]

            # 2. Validacao de esquema ----------------------------------------
            params = validate(contract.parameters, raw_params)

            # 3. Sanitizacao e limite de uso ---------------------------------
            self._check_rate(contract)
            turn.record(name)
            if turn.total_calls() > self.config.max_tool_calls:
                raise Blocked(
                    f"Limite de {self.config.max_tool_calls} chamadas de ferramenta neste turno."
                )

            # 4. Politica de permissao ---------------------------------------
            decision = self.policy.evaluate(contract, params, turn)

            # 5. Portao de confirmacao ---------------------------------------
            phash = params_hash(name, params, call_id)
            if decision.needs_confirmation:
                if confirm is None:
                    raise ConfirmationRequired(
                        render_confirmation(contract, params, decision), phash
                    )
                prompt = render_confirmation(contract, params, decision)
                token = await confirm(prompt, phash, {
                    "tool": name, "params": params, "level": decision.level,
                    "base_level": decision.base_level, "reasons": decision.reasons,
                    "call_id": call_id,
                })
                if not token:
                    confirmed = "negado"
                    raise ConfirmationDenied()
                # Recalcula o hash e compara: se os parametros mudaram, aborta.
                self.policy.verify_confirmation_token(token, params_hash(name, params, call_id))
                confirmed = "aprovado"

            # 6. Execucao ----------------------------------------------------
            result = self._invoke(contract, params)

            # 7. Validacao de resultado --------------------------------------
            result = self._verify(contract, result)
            payload = {"ok": True, **result}
            self._done[call_id] = payload
            self._audit(contract, params, decision, payload, None, started, confirmed, session)
            return payload

        except ToolError as e:
            payload = e.as_result()
            self._audit(contract, raw_params, decision, None, e, started, confirmed, session)
            return payload
        except Exception as e:  # falha inesperada do adaptador
            wrapped = ToolError("ADAPTER_FAILURE", f"{type(e).__name__}: {e}")
            self._audit(contract, raw_params, decision, None, wrapped, started, confirmed, session)
            return wrapped.as_result()

    # ------------------------------------------------------------------
    def _invoke(self, contract, params: dict) -> dict:
        fn = self._adapters.get(contract.name)
        if fn is None:
            raise ToolNotFound(contract.name)
        out = fn(**params)
        if not isinstance(out, dict):
            raise ToolError("BAD_RESULT", f"{contract.name} devolveu {type(out).__name__}.")
        return out

    def _verify(self, contract, result: dict) -> dict:
        """Confere o resultado contra expected_result e a marca de verificacao."""
        missing = [k for k in contract.expected_result if k not in result]
        if missing:
            result["_verification_warning"] = f"campos ausentes no resultado: {missing}"
        if result.get("verified") is False:
            raise ToolError(
                "VERIFICATION_FAILED",
                f"{contract.name} executou mas a verificacao falhou. "
                f"Detalhes: {canonical({k: v for k, v in result.items() if k != 'content'})[:400]}",
            )
        return result

    def _check_rate(self, contract) -> None:
        window = self._calls.setdefault(contract.name, deque())
        now = time.time()
        while window and now - window[0] > 3600:
            window.popleft()
        if len(window) >= contract.rate_limit_per_hour:
            raise RateLimited(contract.name, contract.rate_limit_per_hour)
        window.append(now)

    # ------------------------------------------------------------------
    def _audit(self, contract, params, decision, result, error, started, confirmed, session):
        """Registro com lista de permissao por ferramenta, nunca lista de bloqueio."""
        if contract is None:
            safe_params: dict[str, Any] = {"_": "contrato desconhecido"}
        else:
            safe_params = {}
            for k, v in (params or {}).items():
                if k in contract.log_params:
                    safe_params[k] = v
                elif isinstance(v, list):
                    safe_params[k] = f"<{len(v)} item(ns) omitido(s)>"
                else:
                    safe_params[k] = f"<{type(v).__name__} de {len(str(v))} chars omitido>"
        self.store.audit(
            kind="tool_call",
            tool=contract.name if contract else "?",
            risk_level=decision.level if decision else None,
            base_level=decision.base_level if decision else None,
            escalated=int(bool(decision and decision.escalated)),
            confirmed=confirmed,
            params=safe_params,
            result=_summarize(result) if result else None,
            error=f"{error.code}: {error.message}" if error else None,
            duration_ms=int((time.time() - started) * 1000),
            session=session,
        )


def _summarize(result: dict) -> dict:
    """Resumo do resultado para o log. Conteudo de arquivo nunca entra."""
    out = {}
    for k, v in result.items():
        if k == "content":
            out[k] = f"<{len(str(v))} chars omitido>"
        elif isinstance(v, list):
            out[k] = f"<{len(v)} item(ns)>"
        elif isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "…"
        else:
            out[k] = v
    return out
