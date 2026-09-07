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


def _new_token(length: int = 16) -> str:
    """Token curto o bastante para digitar no celular, longo o bastante para a rede local."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem I, O, 0 e 1
    return "".join(secrets.choice(alphabet) for _ in range(length))


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

    # Endereco de escuta. 127.0.0.1 aceita so esta maquina; 0.0.0.0 aceita a rede
    # local, que e o que permite abrir do celular. Ver `host_is_public`.
    host: str = os.environ.get("JARVIS_HOST", "127.0.0.1")
    port: int = int(os.environ.get("JARVIS_PORT", "8765"))

    # Token de acesso. Obrigatorio sempre que o servidor escuta fora do loopback,
    # porque ai qualquer aparelho da mesma rede alcanca as ferramentas de arquivo.
    token: str = field(default_factory=lambda: os.environ.get("JARVIS_TOKEN", "")
                       or _new_token())

    # Chave efemera de sessao usada para assinar tokens de confirmacao.
    # Vive so na memoria do processo: reiniciar invalida confirmacoes pendentes.
    session_key: bytes = field(default_factory=lambda: secrets.token_bytes(32))

    @property
    def host_is_public(self) -> bool:
        return self.host not in {"127.0.0.1", "localhost", "::1"}

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
            "host": self.host,
            "host_is_public": self.host_is_public,
            "has_api_key": bool(
                os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            ),
        }


CONFIG = Config()
