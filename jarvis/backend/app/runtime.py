"""Montagem da instancia local do JARVIS.

Um unico lugar onde as pecas sao ligadas. O orquestrador recebe o gateway pronto e nunca
importa um adaptador: e assim que o cerebro fica independente das ferramentas (secao 1.3).
"""
from __future__ import annotations

from dataclasses import dataclass

from .core.config import CONFIG, Config
from .memory.store import Store
from .policy.engine import PolicyEngine
from .tools.adapters.files import FilesAdapter
from .tools.adapters.misc import ClockAdapter, MemoryAdapter, RemindersAdapter, SystemAdapter
from .tools.gateway import Gateway
from .tools.registry import Registry


@dataclass
class Runtime:
    config: Config
    store: Store
    registry: Registry
    policy: PolicyEngine
    gateway: Gateway
    files: FilesAdapter

    @classmethod
    def build(cls, config: Config | None = None) -> "Runtime":
        cfg = config or CONFIG
        cfg.ensure_dirs()
        store = Store(cfg.db_path)
        registry = Registry(cfg.tools_dir)
        policy = PolicyEngine(cfg)

        files = FilesAdapter(cfg)
        clock = ClockAdapter()
        memory = MemoryAdapter(store)
        reminders = RemindersAdapter(store)
        system = SystemAdapter(cfg, files)

        adapters = {
            "clock.now": lambda timezone=None: clock.now(timezone),
            "files.list": files.list,
            "files.search": files.search,
            "files.read_text": files.read_text,
            "files.create": files.create,
            "files.create_dir": files.create_dir,
            "files.move": files.move,
            "files.delete": files.delete,
            "memory.save": memory.save,
            "memory.recall": memory.recall,
            "memory.forget": memory.forget,
            "reminders.create": reminders.create,
            "reminders.list": reminders.list,
            "system.open": system.open,
        }
        missing = {c.name for c in registry.all()} - set(adapters)
        if missing:
            raise RuntimeError(f"contratos sem adaptador: {sorted(missing)}")
        extra = set(adapters) - {c.name for c in registry.all()}
        if extra:
            raise RuntimeError(f"adaptadores sem contrato: {sorted(extra)}")

        gateway = Gateway(cfg, registry, policy, store, adapters)
        return cls(config=cfg, store=store, registry=registry, policy=policy,
                   gateway=gateway, files=files)
