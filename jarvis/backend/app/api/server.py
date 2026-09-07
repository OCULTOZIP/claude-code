"""Servidor local: HTTP para o painel, WebSocket para a conversa.

O protocolo do canal segue a secao 4.3 do projeto tecnico, reduzido ao que a versao
local precisa. A confirmacao e bloqueante de verdade: o gateway fica aguardando uma
resposta que so chega pelo WebSocket.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from ..agent.orchestrator import Orchestrator
from ..core.net import access_url
from ..runtime import Runtime

WEB_DIR = Path(__file__).resolve().parents[3] / "client" / "web"

app = FastAPI(title="JARVIS local")
RT = Runtime.build()


def _authorized(supplied: str | None) -> bool:
    """Token exigido sempre que o servidor escuta fora do loopback.

    Preso ao loopback, o proprio sistema operacional ja restringe o acesso a esta
    maquina e o token viraria atrito sem ganho. Aberto para a rede, qualquer
    aparelho no mesmo Wi-Fi alcancaria as ferramentas de arquivo, entao ele passa
    a ser obrigatorio.
    """
    if not RT.config.host_is_public:
        return True
    return bool(supplied) and secrets.compare_digest(supplied, RT.config.token)


@app.middleware("http")
async def gate(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        supplied = request.query_params.get("k") or request.headers.get("x-jarvis-token")
        if not _authorized(supplied):
            return JSONResponse({"error": "token ausente ou invalido"}, status_code=401)
    return await call_next(request)


@app.on_event("startup")
async def announce() -> None:
    cfg = RT.config
    print("\n" + "─" * 62)
    print("  JARVIS pronto")
    print(f"  área concedida  {cfg.workspace}")
    if cfg.host_is_public:
        print(f"  abra no celular  {access_url(cfg.host, cfg.port, cfg.token)}")
        print("  o endereço inteiro importa: sem a parte ?k= o servidor recusa.")
        print("  qualquer aparelho no mesmo Wi-Fi alcança esta porta, e o token")
        print("  é o que separa você dos outros. Não compartilhe.")
    else:
        print(f"  abra no navegador  http://127.0.0.1:{cfg.port}")
        print("  escutando só nesta máquina; para abrir do celular use ./run.sh rede")
    print("─" * 62 + "\n")


# ---------------------------------------------------------------- painel
@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse((WEB_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/api/status")
async def status() -> JSONResponse:
    return JSONResponse({
        **RT.config.describe(),
        "tools_total": len(RT.registry.all()),
        "tools_enabled": len(RT.registry.enabled()),
        "grants": RT.policy.grants(),
        "reminders_pending": len(RT.store.list_reminders()),
        "memories": len(RT.store.all_memories()),
    })


@app.get("/api/tools")
async def tools() -> JSONResponse:
    return JSONResponse([{
        "name": c.name,
        "description": c.description,
        "risk_level": c.risk_level,
        "requires_confirmation": c.requires_confirmation,
        "os_permissions": list(c.os_permissions),
        "runs_on": c.runs_on,
        "enabled": RT.registry.is_enabled(c.name),
    } for c in RT.registry.all()])


@app.post("/api/tools/{name}/toggle")
async def toggle(name: str) -> JSONResponse:
    if not RT.registry.has(name):
        return JSONResponse({"error": "ferramenta desconhecida"}, status_code=404)
    new = not RT.registry.is_enabled(name)
    RT.registry.set_enabled(name, new)
    RT.store.audit(kind="tool_toggle", tool=name, result={"enabled": new}, session="painel")
    return JSONResponse({"name": name, "enabled": new})


@app.get("/api/memory")
async def memory() -> JSONResponse:
    return JSONResponse(RT.store.all_memories())


@app.delete("/api/memory/{mid}")
async def memory_delete(mid: str) -> JSONResponse:
    res = RT.store.forget([mid])
    RT.store.audit(kind="memory_delete", result=res, session="painel")
    return JSONResponse(res)


@app.get("/api/reminders")
async def reminders() -> JSONResponse:
    return JSONResponse(RT.store.list_reminders(include_done=True))


@app.get("/api/audit")
async def audit(limit: int = 80) -> JSONResponse:
    return JSONResponse(RT.store.audit_tail(limit))


@app.post("/api/purge/{what}")
async def purge(what: str) -> JSONResponse:
    if what not in {"tudo", "logs", "conversas", "memoria", "lembretes"}:
        return JSONResponse({"error": "alvo invalido"}, status_code=400)
    return JSONResponse({"apagado": RT.store.purge(what)})


# ---------------------------------------------------------------- conversa
@app.websocket("/ws")
async def ws(sock: WebSocket) -> None:
    if not _authorized(sock.query_params.get("k")):
        # Aceitar antes de fechar e o unico jeito de o navegador receber o codigo
        # 1008. Recusar no handshake vira 1006 no cliente, que nao distingue token
        # invalido de queda de rede e reconectaria em laco.
        await sock.accept()
        await sock.close(code=1008, reason="token ausente ou invalido")
        return
    await sock.accept()
    pending: dict[str, asyncio.Future] = {}

    async def emit(kind: str, data: dict) -> None:
        with contextlib.suppress(Exception):
            await sock.send_text(
                json.dumps({"type": kind, **data}, ensure_ascii=False, default=str)
            )

    async def confirm(prompt: str, phash: str, meta: dict) -> str | None:
        """Bloqueia ate o usuario responder. Aprovado, devolve o token assinado."""
        call_id = meta["call_id"]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        pending[call_id] = fut
        await emit("confirm_request", {
            "prompt": prompt, "call_id": call_id, "tool": meta["tool"],
            "level": meta["level"], "base_level": meta["base_level"],
            "reasons": meta["reasons"],
        })
        try:
            approved = await asyncio.wait_for(fut, timeout=RT.config.confirmation_ttl_seconds)
        except asyncio.TimeoutError:
            await emit("notice", {"text": "Confirmacao expirou sem resposta."})
            return None
        finally:
            pending.pop(call_id, None)
        return RT.policy.issue_confirmation_token(phash) if approved else None

    agent = Orchestrator(RT, emit)
    watcher = asyncio.create_task(_reminder_watcher(emit))
    await emit("ready", {"status": RT.config.describe()})

    try:
        while True:
            msg = json.loads(await sock.receive_text())
            kind = msg.get("type")

            if kind == "confirmation_response":
                fut = pending.get(msg.get("call_id", ""))
                if fut and not fut.done():
                    fut.set_result(bool(msg.get("approved")))
                continue

            if kind == "reset":
                agent.reset()
                await emit("notice", {"text": "Conversa reiniciada."})
                continue

            if kind != "user_message":
                continue

            text = (msg.get("text") or "").strip()
            if not text:
                continue
            await emit("turn_start", {"text": text})
            try:
                await emit("done", await agent.run_turn(text, confirm=confirm))
            except RuntimeError as e:
                await emit("error", {"text": str(e)})
            except Exception as e:  # falha inesperada: relatar, nunca silenciar
                await emit("error", {"text": f"{type(e).__name__}: {e}"})
    except WebSocketDisconnect:
        pass
    finally:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher


async def _reminder_watcher(emit) -> None:
    """Dispara lembretes vencidos. Equivale ao AlarmManager do aparelho."""
    while True:
        await asyncio.sleep(20)
        now = datetime.now().isoformat(timespec="seconds")
        for r in RT.store.due_reminders(now):
            RT.store.mark_reminder_done(r["id"])
            await emit("reminder", {"title": r["title"], "when": r["when_at"],
                                    "notes": r["notes"]})
