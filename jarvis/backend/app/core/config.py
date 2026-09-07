"""Configuracao do JARVIS. Nenhum segredo e escrito aqui; tudo vem do ambiente."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "sim", "on"}


@dataclass
class Config:
    """Estado de configuracao de uma instancia local do JARVIS."""

    # Area concedida. Nenhuma ferramenta de arquivo enxerga nada fora daqui.
    workspace: Path = field(
        default_factory=lambda: Path(
            os.environ.get("JARVIS_WORKSPACE", Path.home() / "jarvis-workspace")
        ).expanduser()
    )
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("JARVIS_DATA", Path.home() / ".jarvis")
        ).expanduser()
    )
    tools_dir: Path = field(default_factory=lambda: REPO_ROOT / "shared" / "tools")

    model: str = os.environ.get("JARVIS_MODEL", "claude-opus-5")
    effort: str = os.environ.get("JARVIS_EFFORT", "high")
    max_tokens: int = int(os.environ.get("JARVIS_MAX_TOKENS", "8000"))

    # Ferramenta de busca web da Anthropic, executada no servidor deles.
    web_search: bool = _bool("JARVIS_WEB_SEARCH", True)

    # Limites do laco do agente (secao 9.4 do projeto tecnico).
    max_iterations: int = int(os.environ.get("JARVIS_MAX_ITERATIONS", "12"))
    max_tool_calls: int = int(os.environ.get("JARVIS_MAX_TOOL_CALLS", "25"))

    # Modo restrito: forca confirmacao ate no nivel 1 (secao 6.4).
    restricted: bool = _bool("JARVIS_RESTRICTED", False)

    confirmation_ttl_seconds: int = 120
    trash_retention_days: int = 7

    # Chave efemera de sessao usada para assinar tokens de confirmacao.
    # Vive so na memoria do processo: reiniciar invalida confirmacoes pendentes.
    session_key: bytes = field(default_factory=lambda: secrets.token_bytes(32))

    def ensure_dirs(self) -> None:
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.sqlite3"

    @property
    def trash_dir(self) -> Path:
        return self.workspace / ".jarvis-lixeira"

    def describe(self) -> dict:
        return {
            "workspace": str(self.workspace),
            "data_dir": str(self.data_dir),
            "model": self.model,
            "effort": self.effort,
            "web_search": self.web_search,
            "restricted": self.restricted,
            "has_api_key": bool(
                os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            ),
        }


CONFIG = Config()
