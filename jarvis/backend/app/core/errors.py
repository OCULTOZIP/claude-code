"""Erros do gateway. Todos carregam um codigo estavel que vai para o log e para o modelo."""
from __future__ import annotations


class ToolError(Exception):
    """Falha tratada de ferramenta. O codigo vem do contrato da ferramenta."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_result(self) -> dict:
        out = {"ok": False, "error_code": self.code, "error": self.message}
        if self.details:
            out["details"] = self.details
        return out


class ToolNotFound(ToolError):
    def __init__(self, name: str):
        super().__init__("TOOL_NOT_FOUND", f"Ferramenta desconhecida: {name}")


class SchemaViolation(ToolError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("SCHEMA_VIOLATION", message, details)


class PermissionMissing(ToolError):
    def __init__(self, permission: str, howto: str = ""):
        msg = f"Permissao ausente: {permission}."
        if howto:
            msg += " " + howto
        super().__init__("PERMISSION_MISSING", msg, {"permission": permission})


class ConfirmationRequired(ToolError):
    """Nao e falha: sinaliza que o portao de confirmacao precisa ser aberto."""

    def __init__(self, prompt: str, params_hash: str):
        super().__init__("CONFIRMATION_REQUIRED", prompt, {"params_hash": params_hash})


class ConfirmationDenied(ToolError):
    def __init__(self):
        super().__init__("CONFIRMATION_DENIED", "O usuario cancelou a acao.")


class ConfirmationInvalid(ToolError):
    def __init__(self, why: str):
        super().__init__("CONFIRMATION_INVALID", f"Token de confirmacao invalido: {why}")


class RateLimited(ToolError):
    def __init__(self, name: str, limit: int):
        super().__init__(
            "RATE_LIMITED", f"Limite de {limit} chamadas por hora atingido para {name}."
        )


class Blocked(ToolError):
    def __init__(self, why: str):
        super().__init__("BLOCKED", why)
