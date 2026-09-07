"""Descoberta do endereco da maquina na rede local.

Usado apenas para imprimir a URL que o celular deve abrir. Nao abre conexao: o
socket UDP so faz o sistema escolher a interface de saida.
"""
from __future__ import annotations

import socket


def lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 9))  # rede reservada para documentacao; nada e enviado
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


def access_url(host: str, port: int, token: str) -> str:
    ip = lan_ip() if host not in {"127.0.0.1", "localhost"} else "127.0.0.1"
    return f"http://{ip or host}:{port}/?k={token}"
