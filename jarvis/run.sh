#!/usr/bin/env bash
# Sobe o JARVIS local. Cria o ambiente virtual na primeira execucao.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${JARVIS_VENV:-.venv}"
[ -d "$VENV" ] || { echo "criando ambiente virtual em $VENV…"; python3 -m venv "$VENV"; }
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

case "${1:-web}" in
  web)
    PORT="${JARVIS_PORT:-8765}"
    echo "abra http://127.0.0.1:$PORT"
    exec env PYTHONPATH=backend "$VENV/bin/python" -m uvicorn app.api.server:app \
      --host 127.0.0.1 --port "$PORT" --app-dir backend
    ;;
  cli)   exec "$VENV/bin/python" client/cli.py ;;
  teste) exec env PYTHONPATH=backend "$VENV/bin/python" -m unittest discover -s tests -v ;;
  *)     echo "uso: ./run.sh [web|cli|teste]"; exit 1 ;;
esac
