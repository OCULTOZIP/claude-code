#!/usr/bin/env bash
# Sobe o JARVIS local. Cria o ambiente virtual na primeira execucao.
set -euo pipefail
cd "$(dirname "$0")"

# As dependencias (anthropic, fastapi, uvicorn) exigem Python 3.10 ou superior.
# O macOS 13 traz 3.9 de fabrica, entao essa checagem vem antes de qualquer coisa.
PY="${JARVIS_PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
  ATUAL="$("$PY" -V 2>/dev/null || echo "nao encontrei o interpretador em: $PY")"
  cat >&2 <<MSG
O JARVIS precisa de Python 3.10 ou superior. Encontrei: $ATUAL

  macOS   brew install python@3.12
          depois: JARVIS_PYTHON=\$(brew --prefix)/bin/python3.12 ./run.sh
  Ubuntu  sudo apt install python3.12 python3.12-venv
  Windows instale pelo python.org e use o WSL ou o Git Bash

Se ja tiver uma versao nova em outro caminho, aponte para ela:
  JARVIS_PYTHON=/caminho/para/python3.12 ./run.sh
MSG
  exit 1
fi

VENV="${JARVIS_VENV:-.venv}"
[ -d "$VENV" ] || { echo "criando ambiente virtual em $VENV com $("$PY" -V)…"; "$PY" -m venv "$VENV"; }
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r requirements.txt

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo
  echo "AVISO: ANTHROPIC_API_KEY nao esta definida."
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  echo "O painel abre e as ferramentas funcionam, mas a conversa falha sem a chave."
  echo
fi

export JARVIS_WORKSPACE="${JARVIS_WORKSPACE:-$HOME/jarvis-workspace}"
mkdir -p "$JARVIS_WORKSPACE"
echo "area concedida: $JARVIS_WORKSPACE"

PORT="${JARVIS_PORT:-8765}"

case "${1:-web}" in
  web)
    # So esta maquina alcanca. Sem token, porque o sistema ja restringe.
    exec env PYTHONPATH=backend JARVIS_HOST=127.0.0.1 JARVIS_PORT="$PORT" \
      "$VENV/bin/python" -m uvicorn app.api.server:app \
      --host 127.0.0.1 --port "$PORT" --app-dir backend
    ;;
  rede)
    # Aceita a rede local, para abrir do celular. O token passa a ser obrigatorio
    # e o endereco completo e impresso na subida do servidor.
    exec env PYTHONPATH=backend JARVIS_HOST=0.0.0.0 JARVIS_PORT="$PORT" \
      "$VENV/bin/python" -m uvicorn app.api.server:app \
      --host 0.0.0.0 --port "$PORT" --app-dir backend
    ;;
  cli)   exec "$VENV/bin/python" client/cli.py ;;
  teste) exec env PYTHONPATH=backend "$VENV/bin/python" -m unittest discover -s tests -v ;;
  *)     echo "uso: ./run.sh [web|rede|cli|teste]"; exit 1 ;;
esac
