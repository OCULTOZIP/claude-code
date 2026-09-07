#!/usr/bin/env python3
"""Cliente de terminal do JARVIS.

Fala com o runtime no mesmo processo, sem passar pelo servidor. Util para maquina sem
ambiente grafico e para testar o gateway sem navegador.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.agent.orchestrator import Orchestrator  # noqa: E402
from app.runtime import Runtime  # noqa: E402

C = {"dim": "\033[2m", "off": "\033[0m", "acc": "\033[36m", "bad": "\033[31m",
     "warn": "\033[33m", "ok": "\033[32m", "b": "\033[1m"}
LEVELS = ["sem risco", "baixo", "moderado", "alto", "bloqueado"]


async def main() -> int:
    rt = Runtime.build()
    print(f"{C['acc']}{C['b']}JARVIS{C['off']} {C['dim']}· terminal{C['off']}")
    print(f"{C['dim']}modelo {rt.config.model} · área concedida {rt.config.workspace}{C['off']}")
    if not rt.config.describe()["has_api_key"]:
        print(f"{C['bad']}ANTHROPIC_API_KEY não está definida. "
              f"Exporte a chave antes de conversar.{C['off']}")
    print(f"{C['dim']}sair, limpar, ferramentas, memoria, logs{C['off']}\n")

    printed_text = False

    async def emit(kind: str, data: dict) -> None:
        nonlocal printed_text
        if kind == "delta":
            if not printed_text:
                print(f"{C['acc']}JARVIS{C['off']} ", end="")
                printed_text = True
            print(data["text"], end="", flush=True)
        elif kind == "tool_start":
            if printed_text:
                print()
                printed_text = False
            print(f"  {C['dim']}→ {data['name']}{C['off']}", flush=True)
        elif kind == "tool_end":
            r = data["result"]
            if r.get("ok"):
                print(f"  {C['ok']}✓ {data['name']}{C['off']}")
            else:
                print(f"  {C['bad']}✗ {data['name']}: "
                      f"{r.get('error_code')} — {r.get('error')}{C['off']}")
        elif kind == "warning":
            print(f"\n{C['warn']}⚠ {data['text']}{C['off']}")
        elif kind == "notice":
            print(f"{C['dim']}{data['text']}{C['off']}")

    async def confirm(prompt: str, phash: str, meta: dict) -> str | None:
        lvl = meta["level"]
        print(f"\n{C['warn']}{'─' * 60}{C['off']}")
        print(f"{C['warn']}{C['b']}CONFIRMAÇÃO · nível {lvl} "
              f"({LEVELS[lvl]}){C['off']}")
        print(prompt)
        if meta["reasons"]:
            print(f"{C['dim']}elevado do nível {meta['base_level']}: "
                  f"{'; '.join(meta['reasons'])}{C['off']}")
        print(f"{C['warn']}{'─' * 60}{C['off']}")
        answer = await asyncio.to_thread(input, "  confirmar? [s/N] ")
        if answer.strip().lower() not in {"s", "sim", "y"}:
            print(f"{C['dim']}  cancelado{C['off']}")
            return None
        return rt.policy.issue_confirmation_token(phash)

    agent = Orchestrator(rt, emit)
    while True:
        try:
            text = (await asyncio.to_thread(input, f"\n{C['b']}você{C['off']} ")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not text:
            continue
        low = text.lower()
        if low in {"sair", "exit", "quit"}:
            return 0
        if low == "limpar":
            agent.reset()
            print(f"{C['dim']}conversa reiniciada{C['off']}")
            continue
        if low == "ferramentas":
            for c in rt.registry.all():
                mark = "on " if rt.registry.is_enabled(c.name) else "off"
                print(f"  {mark} {c.name:22} nível {c.risk_level}"
                      f"{'  confirma' if c.requires_confirmation else ''}")
            continue
        if low == "memoria":
            for m in rt.store.all_memories():
                print(f"  [{m['layer']}] {m['key']}: {m['content']}")
            continue
        if low == "logs":
            for a in rt.store.audit_tail(20):
                print(f"  {a['ts']} {a['tool'] or a['kind']:22} "
                      f"{a['error'] or 'ok'}")
            continue

        printed_text = False
        try:
            result = await agent.run_turn(text, confirm=confirm)
        except RuntimeError as e:
            print(f"{C['bad']}erro: {e}{C['off']}")
            continue
        if printed_text:
            print()
        u = result["usage"]
        print(f"{C['dim']}{len(result['tools'])} ferramenta(s) · cache {u['cache_read']} · "
              f"entrada {u['input']} · saída {u['output']}{C['off']}")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
