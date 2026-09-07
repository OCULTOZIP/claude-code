"""Registro de ferramentas.

Le os contratos de shared/tools/*.json, que sao a fonte unica de verdade descrita na
secao 5.1 do projeto tecnico. A mesma declaracao gera tres coisas: o esquema enviado ao
modelo, o validador de entrada do gateway e a descricao mostrada no dashboard.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..core.errors import SchemaViolation, ToolNotFound

# Chaves do contrato que nao pertencem ao esquema enviado ao modelo.
_CONTRACT_ONLY = {
    "name", "version", "runs_on", "description", "parameters", "os_permissions",
    "risk_level", "requires_confirmation", "confirmation_template", "expected_result",
    "verification", "errors", "log_params", "rate_limit_per_hour",
}


@dataclass(frozen=True)
class ToolContract:
    name: str
    version: int
    runs_on: str
    description: str
    parameters: dict
    os_permissions: tuple[str, ...]
    risk_level: int
    requires_confirmation: bool
    confirmation_template: str
    expected_result: dict
    verification: str
    errors: dict
    log_params: tuple[str, ...]
    rate_limit_per_hour: int

    @classmethod
    def from_dict(cls, d: dict) -> "ToolContract":
        missing = {"name", "description", "parameters", "risk_level"} - set(d)
        if missing:
            raise ValueError(f"contrato incompleto, faltam {sorted(missing)}")
        unknown = set(d) - _CONTRACT_ONLY
        if unknown:
            raise ValueError(f"contrato {d['name']} tem chaves desconhecidas {sorted(unknown)}")
        return cls(
            name=d["name"],
            version=d.get("version", 1),
            runs_on=d.get("runs_on", "device"),
            description=d["description"],
            parameters=d["parameters"],
            os_permissions=tuple(d.get("os_permissions", ())),
            risk_level=int(d["risk_level"]),
            requires_confirmation=bool(d.get("requires_confirmation", False)),
            confirmation_template=d.get("confirmation_template", ""),
            expected_result=d.get("expected_result", {}),
            verification=d.get("verification", ""),
            errors=d.get("errors", {}),
            log_params=tuple(d.get("log_params", ())),
            rate_limit_per_hour=int(d.get("rate_limit_per_hour", 120)),
        )

    def anthropic_schema(self) -> dict:
        """Definicao enviada ao modelo. Estavel byte a byte para nao invalidar o cache."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }


class Registry:
    def __init__(self, tools_dir: Path):
        self.tools_dir = tools_dir
        self._tools: dict[str, ToolContract] = {}
        self._enabled: dict[str, bool] = {}
        self.reload()

    def reload(self) -> None:
        found: dict[str, ToolContract] = {}
        for path in sorted(self.tools_dir.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            contract = ToolContract.from_dict(data)
            if contract.name in found:
                raise ValueError(f"ferramenta duplicada: {contract.name}")
            found[contract.name] = contract
        self._tools = found
        for name in found:
            self._enabled.setdefault(name, True)

    # ---------- consulta ----------
    def get(self, name: str) -> ToolContract:
        if name not in self._tools:
            raise ToolNotFound(name)
        return self._tools[name]

    def has(self, name: str) -> bool:
        return name in self._tools

    def all(self) -> list[ToolContract]:
        return [self._tools[n] for n in sorted(self._tools)]

    def enabled(self) -> list[ToolContract]:
        """Somente as ferramentas ligadas. Uma desligada nem chega ao catalogo do modelo."""
        return [c for c in self.all() if self._enabled.get(c.name, True)]

    def is_enabled(self, name: str) -> bool:
        return self._enabled.get(name, False)

    def set_enabled(self, name: str, value: bool) -> None:
        self.get(name)
        self._enabled[name] = bool(value)

    def catalog_for_model(self) -> list[dict]:
        """Ordem alfabetica fixa: qualquer variacao aqui derruba o cache de prompt."""
        return [c.anthropic_schema() for c in self.enabled()]


# ---------------------------------------------------------------------------
# Validador do subconjunto de JSON Schema usado nos contratos.
# Implementado a mao para o projeto nao depender de biblioteca extra; cobre
# exatamente o que os contratos usam e recusa qualquer construcao fora disso.
# ---------------------------------------------------------------------------

_PY_TYPES = {
    "object": dict, "array": list, "string": str,
    "integer": int, "number": (int, float), "boolean": bool,
}


def validate(schema: dict, value: Any, path: str = "") -> Any:
    """Valida e devolve o valor com os defaults aplicados. Levanta SchemaViolation."""
    where = path or "(raiz)"
    expected = schema.get("type")

    if expected == "object":
        if not isinstance(value, dict):
            raise SchemaViolation(f"{where}: esperava objeto, veio {type(value).__name__}")
        props: dict = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(props))
            if extra:
                raise SchemaViolation(f"{where}: parametro(s) nao previsto(s): {extra}")
        for req in schema.get("required", []):
            if req not in value:
                raise SchemaViolation(f"{where}: parametro obrigatorio ausente: {req}")
        out: dict = {}
        for key, sub in props.items():
            if key in value:
                out[key] = validate(sub, value[key], f"{where}.{key}" if path else key)
            elif "default" in sub:
                out[key] = sub["default"]
        return out

    if expected == "array":
        if not isinstance(value, list):
            raise SchemaViolation(f"{where}: esperava lista, veio {type(value).__name__}")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise SchemaViolation(
                f"{where}: {len(value)} itens excede o maximo de {schema['maxItems']}"
            )
        item_schema = schema.get("items", {})
        return [validate(item_schema, v, f"{where}[{i}]") for i, v in enumerate(value)]

    if "enum" in schema:
        if value not in schema["enum"]:
            raise SchemaViolation(f"{where}: valor '{value}' fora de {schema['enum']}")
        return value

    if expected is None:
        return value

    py = _PY_TYPES.get(expected)
    if py is None:
        raise SchemaViolation(f"{where}: tipo de esquema nao suportado: {expected}")
    # bool e subclasse de int em Python; nao deixar passar como inteiro.
    if expected in {"integer", "number"} and isinstance(value, bool):
        raise SchemaViolation(f"{where}: esperava {expected}, veio boolean")
    if not isinstance(value, py):
        raise SchemaViolation(f"{where}: esperava {expected}, veio {type(value).__name__}")

    if expected == "string":
        if len(value) > 20000:
            raise SchemaViolation(f"{where}: texto excede 20000 caracteres")
    if expected in {"integer", "number"}:
        if "minimum" in schema and value < schema["minimum"]:
            raise SchemaViolation(f"{where}: {value} abaixo do minimo {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            raise SchemaViolation(f"{where}: {value} acima do maximo {schema['maximum']}")
    return value
