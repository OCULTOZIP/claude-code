"""Motor de politica: niveis de risco, escalonamento e confirmacao vinculada.

Implementa as secoes 5.4, 6 e 11.4 do projeto tecnico. O ponto central e que o nivel
declarado no contrato e um piso, nunca um teto: o contexto da chamada pode elevar.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any

from ..core.errors import ConfirmationInvalid
from ..tools.registry import ToolContract

LEVEL_NAMES = {
    0: "sem risco",
    1: "baixo",
    2: "moderado",
    3: "alto",
    4: "bloqueado",
}

# Acima deste tamanho de lote a operacao sobe um nivel (secao 5.4).
BULK_THRESHOLD = 20
# Mesma ferramenta repetida acima disto no mesmo turno sugere laco.
LOOP_THRESHOLD = 5


def canonical(params: dict) -> str:
    """Serializacao estavel. Duas chamadas iguais precisam gerar o mesmo texto."""
    return json.dumps(params, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def params_hash(name: str, params: dict, call_id: str) -> str:
    raw = f"{name}\x00{canonical(params)}\x00{call_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


@dataclass
class TurnState:
    """Estado de um unico turno. Zerado a cada mensagem do usuario."""

    calls: dict[str, int] = field(default_factory=dict)
    tainted: bool = False  # conteudo nao confiavel entrou no contexto deste turno
    taint_sources: list[str] = field(default_factory=list)

    def record(self, name: str) -> int:
        self.calls[name] = self.calls.get(name, 0) + 1
        return self.calls[name]

    def taint(self, source: str) -> None:
        self.tainted = True
        if source not in self.taint_sources:
            self.taint_sources.append(source)

    def total_calls(self) -> int:
        return sum(self.calls.values())


@dataclass
class Decision:
    level: int
    base_level: int
    needs_confirmation: bool
    reasons: list[str]

    @property
    def escalated(self) -> bool:
        return self.level > self.base_level


class PolicyEngine:
    def __init__(self, config):
        self.config = config
        # Concessoes por ferramenta: None = sem concessao permanente.
        self._grants: dict[str, dict[str, Any]] = {}

    # ---------- concessoes ----------
    def grant(self, tool: str, scope: str = "sempre", ttl_seconds: int | None = None) -> None:
        """Concessao permanente so e aceita ate o nivel 2 (secao 6.3)."""
        self._grants[tool] = {
            "scope": scope,
            "expires_at": time.time() + ttl_seconds if ttl_seconds else None,
        }

    def revoke(self, tool: str) -> None:
        self._grants.pop(tool, None)

    def has_grant(self, tool: str) -> bool:
        g = self._grants.get(tool)
        if not g:
            return False
        if g["expires_at"] is not None and time.time() > g["expires_at"]:
            self._grants.pop(tool, None)
            return False
        return True

    def grants(self) -> dict:
        return {
            k: {"scope": v["scope"],
                "expires_in": None if v["expires_at"] is None else max(0, int(v["expires_at"] - time.time()))}
            for k, v in self._grants.items()
            if self.has_grant(k)
        }

    # ---------- decisao ----------
    def evaluate(self, contract: ToolContract, params: dict, turn: TurnState) -> Decision:
        base = contract.risk_level
        level = base
        reasons: list[str] = []

        # Lote grande.
        n = _batch_size(params)
        if n > BULK_THRESHOLD:
            level += 1
            reasons.append(f"lote de {n} itens acima do limite de {BULK_THRESHOLD}")

        # Parametro derivado de conteudo nao confiavel (secao 11.5, regra 2).
        # Conservador de proposito: qualquer escrita apos entrada de conteudo externo
        # neste turno sobe um nivel, sem tentar rastrear substring.
        if turn.tainted and base >= 1:
            level += 1
            reasons.append(
                "conteudo externo entrou neste turno (" + ", ".join(turn.taint_sources) + ")"
            )

        # Suspeita de laco.
        repeats = turn.calls.get(contract.name, 0)
        if repeats >= LOOP_THRESHOLD:
            level += 1
            reasons.append(f"{contract.name} ja chamada {repeats} vezes neste turno")

        level = min(level, 3)  # nivel 4 nao e alcancavel por escalonamento; ver abaixo

        needs = contract.requires_confirmation or level >= 2
        if self.config.restricted and level >= 1:
            needs = True
            reasons.append("modo restrito ativo")
        # Concessao permanente dispensa confirmacao ate o nivel 2, nunca no 3.
        if needs and level <= 2 and self.has_grant(contract.name) and not turn.tainted:
            needs = False
            reasons.append("concessao previa do usuario")

        return Decision(level=level, base_level=base, needs_confirmation=needs, reasons=reasons)

    # ---------- confirmacao vinculada (secao 11.4) ----------
    def issue_confirmation_token(self, phash: str) -> str:
        """Assina o hash dos parametros com a chave efemera da sessao."""
        expires = int(time.time()) + self.config.confirmation_ttl_seconds
        payload = f"{phash}:{expires}"
        sig = hmac.new(self.config.session_key, payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}:{sig}"

    def verify_confirmation_token(self, token: str, phash: str) -> None:
        """Recalcula e compara. Divergencia aborta a execucao."""
        try:
            got_hash, expires_s, sig = token.split(":")
            expires = int(expires_s)
        except ValueError:
            raise ConfirmationInvalid("formato irreconhecivel")
        expected = hmac.new(
            self.config.session_key, f"{got_hash}:{expires}".encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise ConfirmationInvalid("assinatura nao confere")
        if not hmac.compare_digest(got_hash, phash):
            raise ConfirmationInvalid("os parametros mudaram depois da aprovacao")
        if time.time() > expires:
            raise ConfirmationInvalid("expirado")


def _batch_size(params: dict) -> int:
    """Maior lista entre os parametros, que e o tamanho do lote da operacao."""
    sizes = [len(v) for v in params.values() if isinstance(v, list)]
    return max(sizes) if sizes else 1


def render_confirmation(contract: ToolContract, params: dict, decision: Decision) -> str:
    """Texto exibido ao usuario, gerado a partir do MESMO dicionario que virou hash."""
    n = _batch_size(params)
    tpl = contract.confirmation_template or "Vou executar {tool} com: {params}"
    try:
        body = tpl.format(n=n, tool=contract.name, params=canonical(params), **params)
    except (KeyError, IndexError):
        body = f"Vou executar {contract.name} com: {canonical(params)}"
    head = f"[nivel {decision.level} · {LEVEL_NAMES[decision.level]}]"
    if decision.escalated:
        head += f" (elevado do nivel {decision.base_level}: {'; '.join(decision.reasons)})"
    return f"{head}\n{body}"
