"""Adaptador de arquivos, restrito a area concedida.

Equivale ao adaptador SAF do Android descrito na secao 12.1. A diferenca esta em como o
caminho e representado: no Android sao URIs de documento devolvidas por uma listagem
anterior; aqui sao caminhos relativos a raiz concedida. A garantia e a mesma: o caminho
resolvido tem de ficar dentro da raiz, e a checagem e feita apos resolver links
simbolicos, nao antes.
"""
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from ...core.errors import ToolError

_TEXT_SNIFF = 4096


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


class FilesAdapter:
    def __init__(self, config):
        self.config = config

    # ---------- fronteira da area concedida ----------
    @property
    def root(self) -> Path:
        return self.config.workspace.resolve()

    def resolve(self, rel: str | None, *, must_exist: bool = False) -> Path:
        """Resolve um caminho relativo e garante que ele fica dentro da raiz concedida."""
        rel = (rel or "").strip()
        candidate = (self.root / rel) if rel else self.root
        # strict=False resolve links e '..' mesmo em caminho ainda inexistente.
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError:
            raise ToolError(
                "OUTSIDE_GRANT",
                f"'{rel}' fica fora da area concedida ({self.root}).",
                {"resolved": str(resolved)},
            )
        if must_exist and not resolved.exists():
            raise ToolError("NOT_FOUND", f"'{rel}' nao existe na area concedida.")
        return resolved

    def rel(self, p: Path) -> str:
        try:
            return str(p.resolve().relative_to(self.root)) or "."
        except ValueError:
            return str(p)

    def _skip(self, p: Path) -> bool:
        """A lixeira nao aparece em listagens e buscas."""
        return self.config.trash_dir.name in p.parts

    # ---------- leitura ----------
    def list(self, path: str | None = None, max_results: int = 200) -> dict:
        target = self.resolve(path, must_exist=True)
        if not target.is_dir():
            raise ToolError("NOT_A_DIRECTORY", f"'{self.rel(target)}' nao e um diretorio.")
        entries = []
        for child in sorted(target.iterdir(), key=lambda c: (c.is_file(), c.name.lower())):
            if self._skip(child):
                continue
            try:
                st = child.stat()
            except OSError:
                continue
            entries.append({
                "path": self.rel(child),
                "kind": "pasta" if child.is_dir() else "arquivo",
                "size": st.st_size if child.is_file() else None,
                "modified": _iso(st.st_mtime),
            })
            if len(entries) >= max_results:
                break
        return {"path": self.rel(target), "entries": entries, "count": len(entries)}

    def search(self, query: str | None = None, extensions: list[str] | None = None,
               modified_since: str | None = None, path: str | None = None,
               max_results: int = 200) -> dict:
        base = self.resolve(path, must_exist=True)
        since = None
        if modified_since:
            try:
                since = datetime.fromisoformat(modified_since.replace("Z", "+00:00"))
                if since.tzinfo is None:
                    since = since.astimezone()
            except ValueError:
                raise ToolError("BAD_TIMESTAMP", f"'{modified_since}' nao e uma data ISO valida.")
        exts = {e.lower().lstrip(".") for e in (extensions or [])}
        q = (query or "").lower()
        matches, truncated = [], False
        for p in sorted(base.rglob("*")):
            if not p.is_file() or self._skip(p):
                continue
            if exts and p.suffix.lower().lstrip(".") not in exts:
                continue
            if q and q not in p.name.lower():
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            if since and datetime.fromtimestamp(st.st_mtime, timezone.utc) < since:
                continue
            if len(matches) >= max_results:
                truncated = True
                break
            matches.append({"path": self.rel(p), "size": st.st_size,
                            "modified": _iso(st.st_mtime)})
        return {"matches": matches, "count": len(matches), "truncated": truncated}

    def read_text(self, path: str, max_bytes: int = 40000) -> dict:
        target = self.resolve(path, must_exist=True)
        if not target.is_file():
            raise ToolError("NOT_FOUND", f"'{self.rel(target)}' nao e um arquivo.")
        raw = target.read_bytes()[: max_bytes + 1]
        if b"\x00" in raw[:_TEXT_SNIFF]:
            raise ToolError("NOT_TEXT", f"'{self.rel(target)}' nao parece ser texto.")
        truncated = len(raw) > max_bytes
        try:
            content = raw[:max_bytes].decode("utf-8")
        except UnicodeDecodeError:
            raise ToolError("NOT_TEXT", f"'{self.rel(target)}' nao e texto UTF-8 legivel.")
        return {"path": self.rel(target), "content": content, "truncated": truncated}

    # ---------- escrita ----------
    def create(self, path: str, content: str, overwrite: bool = False) -> dict:
        target = self.resolve(path)
        if target.exists() and not overwrite:
            raise ToolError("ALREADY_EXISTS",
                            f"'{self.rel(target)}' ja existe. Use overwrite se for intencional.")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        except OSError as e:
            raise ToolError("WRITE_FAILED", f"Falha ao escrever: {e}")
        # Verificacao: reler e conferir o tamanho.
        written = target.stat().st_size
        return {"path": self.rel(target), "bytes": written,
                "verified": target.read_text(encoding="utf-8") == content}

    def create_dir(self, path: str) -> dict:
        target = self.resolve(path)
        existed = target.exists()
        if existed and not target.is_dir():
            raise ToolError("ALREADY_EXISTS", f"'{self.rel(target)}' existe e nao e pasta.")
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise ToolError("WRITE_FAILED", f"Falha ao criar a pasta: {e}")
        # Verificacao: relistar a pasta-mae e confirmar a presenca.
        parent = target.parent
        listing = sorted(c.name for c in parent.iterdir() if not self._skip(c))
        if target.name not in listing:
            raise ToolError("WRITE_FAILED", "A pasta nao aparece na listagem apos a criacao.")
        return {"path": self.rel(target), "created": not existed,
                "parent_listing_after": listing[:100]}

    def move(self, sources: list[str], destination_dir: str,
             on_conflict: str = "rename") -> dict:
        dest = self.resolve(destination_dir)
        if dest.exists() and not dest.is_dir():
            raise ToolError("DESTINATION_NOT_DIR", f"'{self.rel(dest)}' nao e uma pasta.")
        dest.mkdir(parents=True, exist_ok=True)
        moved, skipped = [], []
        for src in sources:
            try:
                s = self.resolve(src, must_exist=True)
            except ToolError as e:
                skipped.append({"path": src, "reason": e.code})
                continue
            if s == dest or s in dest.parents:
                skipped.append({"path": src, "reason": "DESTINO_DENTRO_DA_ORIGEM"})
                continue
            target = dest / s.name
            if target.exists():
                if on_conflict == "skip":
                    skipped.append({"path": src, "reason": "JA_EXISTE_NO_DESTINO"})
                    continue
                if on_conflict == "fail":
                    raise ToolError("PARTIAL_FAILURE",
                                    f"'{s.name}' ja existe no destino.",
                                    {"moved": moved, "skipped": skipped})
                stem, suffix, i = target.stem, target.suffix, 2
                while target.exists():
                    target = dest / f"{stem} ({i}){suffix}"
                    i += 1
            try:
                shutil.move(str(s), str(target))
                moved.append({"from": src, "to": self.rel(target)})
            except OSError as e:
                skipped.append({"path": src, "reason": f"ERRO: {e}"})
        # Verificacao: relistar o destino e conferir cada item movido.
        listing = sorted(c.name for c in dest.iterdir())
        missing = [m["to"] for m in moved if Path(m["to"]).name not in listing]
        return {"moved": moved, "skipped": skipped,
                "destination_listing_after": listing[:200],
                "verification_missing": missing,
                "verified": not missing}

    def delete(self, paths: list[str]) -> dict:
        """Nao apaga: move para a lixeira do JARVIS (secao 11.6)."""
        trash = self.config.trash_dir / datetime.now().strftime("%Y-%m-%d")
        trash.mkdir(parents=True, exist_ok=True)
        trashed, skipped = [], []
        for raw in paths:
            try:
                s = self.resolve(raw, must_exist=True)
            except ToolError as e:
                skipped.append({"path": raw, "reason": e.code})
                continue
            if self._skip(s):
                skipped.append({"path": raw, "reason": "JA_ESTA_NA_LIXEIRA"})
                continue
            target = trash / s.name
            i = 2
            while target.exists():
                target = trash / f"{s.stem} ({i}){s.suffix}"
                i += 1
            try:
                shutil.move(str(s), str(target))
            except OSError as e:
                skipped.append({"path": raw, "reason": f"TRASH_FAILED: {e}"})
                continue
            trashed.append({"original": raw, "trash_path": self.rel(target)})
        # Verificacao: ausencia na origem e presenca na lixeira.
        bad = [t for t in trashed
               if (self.root / t["original"]).exists() or not (self.root / t["trash_path"]).exists()]
        return {"trashed": trashed, "skipped": skipped,
                "retention_days": self.config.trash_retention_days,
                "verified": not bad}
