"""Loop do agente (secao 9.4).

Chama o modelo, despacha ferramentas pelo gateway, devolve TODOS os tool_result num
unico turno de usuario e verifica o texto final contra o que realmente foi executado.
"""
from __future__ import annotations

import os
import re
import uuid
from typing import Any, Awaitable, Callable

import anthropic

from ..policy.engine import TurnState
from .prompt import SYSTEM, preferences_block

# Verbos que afirmam execucao. Usados pelo verificador pos-turno.
_CLAIM = re.compile(
    r"\b(criei|criado|criada|movi|movido|movida|apaguei|apagado|excluí|exclui|"
    r"salvei|salvo|salva|guardei|agendei|agendado|marquei|abri|renomeei|"
    r"organizei|copiei)\b",
    re.IGNORECASE,
)
_WRITE_TOOLS = {
    "files.create", "files.create_dir", "files.move", "files.delete",
    "memory.save", "memory.forget", "reminders.create", "system.open",
}

Emit = Callable[[str, dict], Awaitable[None]]
ConfirmFn = Callable[[str, str, dict], Awaitable[str | None]]


class Orchestrator:
    def __init__(self, runtime, emit: Emit | None = None):
        self.rt = runtime
        self.emit = emit or (lambda kind, data: _noop())
        self.history: list[dict] = []
        self._client: anthropic.AsyncAnthropic | None = None

    # ------------------------------------------------------------------
    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
                raise RuntimeError(
                    "ANTHROPIC_API_KEY nao esta definida. Exporte a chave antes de iniciar: "
                    "export ANTHROPIC_API_KEY=sk-ant-..."
                )
            self._client = anthropic.AsyncAnthropic()
        return self._client

    def _tools(self) -> list[dict]:
        """Ordem fixa. Ferramentas primeiro no prefixo, entao nada aqui pode variar."""
        tools = list(self.rt.registry.catalog_for_model())
        if self.rt.config.web_search:
            tools.append({
                "type": "web_search_20260209",
                "name": "web_search",
                "max_uses": 5,
            })
        return tools

    def _system(self) -> list[dict]:
        blocks = [{"type": "text", "text": SYSTEM}]
        prefs = preferences_block(self.rt.store.preferences_block())
        if prefs:
            blocks.append({"type": "text", "text": prefs})
        # Ponto de corte do cache no fim do prefixo estavel.
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    # ------------------------------------------------------------------
    async def run_turn(self, user_text: str, confirm: ConfirmFn | None = None) -> dict:
        turn = TurnState()
        turn_id = uuid.uuid4().hex[:12]
        self.history.append({"role": "user", "content": user_text})

        executed: list[str] = []
        final_text = ""
        usage_total = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        iterations = 0
        stopped_reason = "end_turn"

        while True:
            iterations += 1
            if iterations > self.rt.config.max_iterations:
                stopped_reason = "max_iterations"
                await self.emit("notice", {
                    "text": f"Parei apos {self.rt.config.max_iterations} rodadas de "
                            "ferramenta neste turno."})
                break

            kwargs: dict[str, Any] = dict(
                model=self.rt.config.model,
                max_tokens=self.rt.config.max_tokens,
                system=self._system(),
                tools=self._tools(),
                messages=self.history,
                thinking={"type": "adaptive"},
                output_config={"effort": self.rt.config.effort},
            )

            text_this_round = ""
            try:
                async with self.client.messages.stream(**kwargs) as stream:
                    async for chunk in stream.text_stream:
                        text_this_round += chunk
                        await self.emit("delta", {"text": chunk})
                    message = await stream.get_final_message()
            except anthropic.AuthenticationError:
                raise RuntimeError("Chave de API invalida. Confira ANTHROPIC_API_KEY.")
            except anthropic.RateLimitError as e:
                retry = e.response.headers.get("retry-after", "60") if e.response else "60"
                raise RuntimeError(f"Limite de taxa da API atingido. Tente em {retry}s.")
            except anthropic.APIConnectionError as e:
                raise RuntimeError(f"Falha de rede ao chamar o modelo: {e}")

            u = message.usage
            usage_total["input"] += getattr(u, "input_tokens", 0) or 0
            usage_total["output"] += getattr(u, "output_tokens", 0) or 0
            usage_total["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
            usage_total["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0

            if message.stop_reason == "refusal":
                stopped_reason = "refusal"
                final_text = ("O modelo recusou este pedido por politica de seguranca. "
                              "Reformule ou peca outra coisa.")
                self.history.append({"role": "assistant", "content": message.content})
                break

            self.history.append({"role": "assistant", "content": message.content})

            # Ferramenta de servidor pausou o turno; reenviar para continuar.
            if message.stop_reason == "pause_turn":
                turn.taint("web.search")
                continue

            # Busca web da Anthropic ja executou no servidor deles: marca o turno.
            if any(getattr(b, "type", "") == "web_search_tool_result" for b in message.content):
                turn.taint("web.search")

            tool_uses = [b for b in message.content if getattr(b, "type", "") == "tool_use"]
            if not tool_uses:
                final_text = text_this_round
                break

            results = []
            for block in tool_uses:
                await self.emit("tool_start", {"name": block.name, "input": block.input,
                                               "id": block.id})
                result = await self.rt.gateway.execute(
                    block.name, dict(block.input), turn, confirm=confirm,
                    call_id=block.id, session=turn_id,
                )
                executed.append(block.name)
                await self.emit("tool_end", {"name": block.name, "result": result,
                                             "id": block.id})
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": _as_text(result),
                    "is_error": not result.get("ok", False),
                })
            # Todos os resultados num UNICO turno de usuario.
            self.history.append({"role": "user", "content": results})

        warnings = verify_turn(final_text, executed)
        for w in warnings:
            await self.emit("warning", {"text": w})

        self.rt.store.save_turn(turn_id, user_text, final_text, len(executed), "local")
        return {
            "turn_id": turn_id,
            "text": final_text,
            "tools": executed,
            "usage": usage_total,
            "warnings": warnings,
            "iterations": iterations,
            "stop": stopped_reason,
            "tainted": turn.tainted,
        }

    def reset(self) -> None:
        self.history.clear()


def verify_turn(text: str, executed: list[str]) -> list[str]:
    """Verificador pos-turno: o texto afirma execucao sem ferramenta de escrita ter rodado?"""
    if not text or not _CLAIM.search(text):
        return []
    if any(t in _WRITE_TOOLS for t in executed):
        return []
    return [
        "Verificacao: a resposta afirma ter executado uma acao, mas nenhuma ferramenta de "
        "escrita rodou neste turno. Trate a afirmacao como nao confirmada."
    ]


def _as_text(result: dict) -> str:
    import json
    return json.dumps(result, ensure_ascii=False, default=str)[:20000]


async def _noop() -> None:
    return None
