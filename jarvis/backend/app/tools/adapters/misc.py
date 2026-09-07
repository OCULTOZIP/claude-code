"""Adaptadores de relogio, memoria, lembretes e abertura pelo sistema."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ...core.errors import ToolError

_DIAS = ["segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
         "sexta-feira", "sabado", "domingo"]


class ClockAdapter:
    def now(self, timezone_name: str | None = None) -> dict:
        if timezone_name:
            try:
                tz = ZoneInfo(timezone_name)
            except (ZoneInfoNotFoundError, ValueError):
                raise ToolError("UNKNOWN_TIMEZONE", f"Fuso desconhecido: {timezone_name}")
            name = timezone_name
        else:
            tz = datetime.now().astimezone().tzinfo
            name = os.environ.get("TZ") or str(tz)
        now = datetime.now(tz)
        return {
            "iso": now.isoformat(timespec="seconds"),
            "timezone": name,
            "weekday": _DIAS[now.weekday()],
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M"),
            "tomorrow": (now + timedelta(days=1)).strftime("%Y-%m-%d"),
        }


class MemoryAdapter:
    def __init__(self, store):
        self.store = store

    def save(self, layer: str, key: str, content: str) -> dict:
        try:
            saved = self.store.save_memory(layer, key, content)
        except ValueError as e:
            raise ToolError(
                "SENSITIVE_CONTENT",
                f"Nao vou guardar isso: parece {e}. Se for intencional, grave pelo painel.",
            )
        # Verificacao: reler o item gravado.
        back = [m for m in self.store.all_memories(layer) if m["id"] == saved["id"]]
        return {**saved, "verified": bool(back),
                "stored_content": back[0]["content"] if back else None}

    def recall(self, query: str, limit: int = 8) -> dict:
        items = self.store.recall(query, limit)
        return {"items": [{"id": m["id"], "layer": m["layer"], "key": m["key"],
                           "content": m["content"], "created_at": m["created_at"]}
                          for m in items],
                "count": len(items)}

    def forget(self, ids: list[str]) -> dict:
        res = self.store.forget(ids)
        if not res["deleted"] and res["missing"]:
            raise ToolError("NOT_FOUND", f"Nenhum id corresponde: {res['missing']}")
        still = [m["id"] for m in self.store.all_memories() if m["id"] in res["deleted"]]
        return {**res, "verified": not still}


class RemindersAdapter:
    def __init__(self, store):
        self.store = store

    def create(self, title: str, when: str, notes: str = "") -> dict:
        try:
            when_dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
        except ValueError:
            raise ToolError("BAD_TIMESTAMP",
                            f"'{when}' nao e uma data ISO valida. Use 2026-09-08T08:00:00.")
        ref = datetime.now(when_dt.tzinfo) if when_dt.tzinfo else datetime.now()
        if when_dt < ref - timedelta(minutes=1):
            raise ToolError("IN_THE_PAST",
                            f"{when_dt.isoformat(timespec='minutes')} ja passou.")
        rec = self.store.create_reminder(title, when_dt.isoformat(timespec="seconds"), notes)
        back = [r for r in self.store.list_reminders(include_done=True) if r["id"] == rec["id"]]
        return {"id": rec["id"], "title": rec["title"], "when": rec["when_at"],
                "notes": rec["notes"], "verified": bool(back)}

    def list(self, include_done: bool = False) -> dict:
        rows = self.store.list_reminders(include_done)
        return {"reminders": [{"id": r["id"], "title": r["title"], "when": r["when_at"],
                               "notes": r["notes"], "done": bool(r["done"])} for r in rows],
                "count": len(rows)}


class SystemAdapter:
    """Abre arquivo ou URL no aplicativo padrao. Equivale a apps.open do Android."""

    def __init__(self, config, files_adapter):
        self.config = config
        self.files = files_adapter

    @staticmethod
    def _opener() -> tuple[list[str], str] | None:
        if sys.platform == "darwin" and shutil.which("open"):
            return ["open"], "open"
        if os.name == "nt":
            return ["cmd", "/c", "start", ""], "start"
        for cand in ("xdg-open", "gio", "gnome-open"):
            if shutil.which(cand):
                return ([cand, "open"] if cand == "gio" else [cand]), cand
        return None

    def open(self, target: str) -> dict:
        parsed = urlparse(target)
        if parsed.scheme in {"http", "https"}:
            arg = target
        elif parsed.scheme in {"", "file"}:
            path = self.files.resolve(parsed.path if parsed.scheme == "file" else target,
                                      must_exist=True)
            arg = str(path)
        else:
            raise ToolError("BLOCKED_SCHEME",
                            f"Esquema '{parsed.scheme}' nao e aceito. Use http, https ou um "
                            "arquivo da area concedida.")
        found = self._opener()
        if not found:
            raise ToolError("NO_HANDLER",
                            "O sistema nao tem xdg-open, open ou start disponivel. "
                            "Em servidor sem ambiente grafico isso e esperado.")
        cmd, handler = found
        try:
            proc = subprocess.run([*cmd, arg], capture_output=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise ToolError("NO_HANDLER", f"Falha ao invocar {handler}: {e}")
        if proc.returncode != 0:
            raise ToolError(
                "NO_HANDLER",
                f"{handler} retornou codigo {proc.returncode}: "
                f"{proc.stderr.decode(errors='replace')[:200]}",
            )
        return {"target": arg, "opened": True, "handler": handler}
