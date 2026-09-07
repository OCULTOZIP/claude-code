"""Memoria, lembretes e trilha de auditoria em SQLite.

Camadas conforme a secao 7. A regra que define o comportamento: preferencias e projetos
so recebem escrita quando o usuario manda, e toda escrita passa pelo filtro de
sensibilidade antes de tocar o banco.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, layer TEXT NOT NULL, key TEXT NOT NULL,
  content TEXT NOT NULL, origin TEXT, created_at TEXT NOT NULL, accessed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_layer ON memories(layer);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, when_at TEXT NOT NULL,
  notes TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rem_when ON reminders(when_at);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL,
  tool TEXT, risk_level INTEGER, base_level INTEGER, escalated INTEGER,
  confirmed TEXT, params TEXT, result TEXT, error TEXT, duration_ms INTEGER,
  session TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, user_text TEXT, assistant_text TEXT,
  tool_calls INTEGER DEFAULT 0, session TEXT
);
"""

# Filtro deterministico do secao 7.3. Bloqueia antes de qualquer classificador.
SENSITIVE_PATTERNS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"), "chave de API Anthropic"),
    (re.compile(r"\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b"), "chave de API"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "token do GitHub"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "chave privada"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{20,}", re.I), "token bearer"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"), "JWT"),
    (re.compile(r"\b(senha|password|passwd|secret|token|api[_ -]?key)\b\s*[:=]\s*\S{4,}", re.I),
     "credencial em texto claro"),
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "possivel CPF"),
]


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def sensitivity_check(text: str) -> str | None:
    """Devolve o motivo do bloqueio, ou None se o texto pode ser gravado."""
    for pattern, why in SENSITIVE_PATTERNS:
        if pattern.search(text):
            return why
    for candidate in re.findall(r"\b(?:\d[ -]?){13,19}\b", text):
        digits = re.sub(r"\D", "", candidate)
        if 13 <= len(digits) <= 19 and _luhn(digits):
            return "possivel numero de cartao"
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.commit()

    # ---------- memoria ----------
    def save_memory(self, layer: str, key: str, content: str, origin: str = "usuario") -> dict:
        reason = sensitivity_check(content)
        if reason:
            raise ValueError(reason)
        dup = self.db.execute(
            "SELECT id FROM memories WHERE layer=? AND key=? AND content=?", (layer, key, content)
        ).fetchone()
        if dup:
            return {"id": dup["id"], "layer": layer, "duplicate": True}
        mid = uuid.uuid4().hex[:12]
        self.db.execute(
            "INSERT INTO memories (id,layer,key,content,origin,created_at) VALUES (?,?,?,?,?,?)",
            (mid, layer, key, content, origin, _now()),
        )
        self.db.commit()
        return {"id": mid, "layer": layer, "duplicate": False}

    def recall(self, query: str, limit: int = 8) -> list[dict]:
        terms = [t for t in re.split(r"\W+", query.lower()) if len(t) > 2]
        rows = self.db.execute("SELECT * FROM memories ORDER BY created_at DESC").fetchall()
        scored = []
        for r in rows:
            hay = f"{r['key']} {r['content']}".lower()
            score = sum(1 for t in terms if t in hay)
            if score or not terms:
                scored.append((score, dict(r)))
        scored.sort(key=lambda x: -x[0])
        out = [d for _, d in scored[:limit]]
        for d in out:
            self.db.execute("UPDATE memories SET accessed_at=? WHERE id=?", (_now(), d["id"]))
        self.db.commit()
        return out

    def all_memories(self, layer: str | None = None) -> list[dict]:
        if layer:
            rows = self.db.execute(
                "SELECT * FROM memories WHERE layer=? ORDER BY created_at DESC", (layer,)
            ).fetchall()
        else:
            rows = self.db.execute("SELECT * FROM memories ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def forget(self, ids: list[str]) -> dict:
        deleted, missing = [], []
        for i in ids:
            cur = self.db.execute("DELETE FROM memories WHERE id=?", (i,))
            (deleted if cur.rowcount else missing).append(i)
        self.db.commit()
        return {"deleted": deleted, "missing": missing}

    def preferences_block(self) -> str:
        """Preferencias entram no prefixo estavel do prompt, entao ficam ordenadas."""
        rows = self.db.execute(
            "SELECT key, content FROM memories WHERE layer='preferencia' ORDER BY key"
        ).fetchall()
        if not rows:
            return ""
        return "\n".join(f"- {r['key']}: {r['content']}" for r in rows)

    # ---------- lembretes ----------
    def create_reminder(self, title: str, when_at: str, notes: str = "") -> dict:
        rid = uuid.uuid4().hex[:12]
        self.db.execute(
            "INSERT INTO reminders (id,title,when_at,notes,created_at) VALUES (?,?,?,?,?)",
            (rid, title, when_at, notes, _now()),
        )
        self.db.commit()
        row = self.db.execute("SELECT * FROM reminders WHERE id=?", (rid,)).fetchone()
        return dict(row)

    def list_reminders(self, include_done: bool = False) -> list[dict]:
        sql = "SELECT * FROM reminders"
        if not include_done:
            sql += " WHERE done=0"
        sql += " ORDER BY when_at ASC"
        return [dict(r) for r in self.db.execute(sql).fetchall()]

    def due_reminders(self, now_iso: str) -> list[dict]:
        rows = self.db.execute(
            "SELECT * FROM reminders WHERE done=0 AND when_at<=? ORDER BY when_at", (now_iso,)
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_reminder_done(self, rid: str) -> None:
        self.db.execute("UPDATE reminders SET done=1 WHERE id=?", (rid,))
        self.db.commit()

    # ---------- auditoria ----------
    def audit(self, **kw) -> None:
        kw.setdefault("ts", _now())
        for k in ("params", "result"):
            if isinstance(kw.get(k), (dict, list)):
                kw[k] = json.dumps(kw[k], ensure_ascii=False)
        cols = ",".join(kw)
        marks = ",".join("?" * len(kw))
        self.db.execute(f"INSERT INTO audit ({cols}) VALUES ({marks})", tuple(kw.values()))
        self.db.commit()

    def audit_tail(self, limit: int = 100) -> list[dict]:
        rows = self.db.execute(
            "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def save_turn(self, tid: str, user_text: str, assistant_text: str, tool_calls: int,
                  session: str) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO turns (id,ts,user_text,assistant_text,tool_calls,session)"
            " VALUES (?,?,?,?,?,?)",
            (tid, _now(), user_text, assistant_text, tool_calls, session),
        )
        self.db.commit()

    def recent_turns(self, limit: int = 20) -> list[dict]:
        rows = self.db.execute(
            "SELECT * FROM turns ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def purge(self, what: str = "tudo") -> dict:
        counts = {}
        tables = {"tudo": ["audit", "turns"], "logs": ["audit"], "conversas": ["turns"],
                  "memoria": ["memories"], "lembretes": ["reminders"]}[what]
        for t in tables:
            counts[t] = self.db.execute(f"SELECT COUNT(*) c FROM {t}").fetchone()["c"]
            self.db.execute(f"DELETE FROM {t}")
        self.db.commit()
        return counts
