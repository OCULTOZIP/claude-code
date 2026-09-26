#!/usr/bin/env bash
# Cria banco e papéis para desenvolvimento/CI. NÃO usar em produção:
# lá os papéis e senhas são provisionados pela infraestrutura.
set -euo pipefail

DB_NAME="${DB_NAME:-norbius}"
PSQL="${PSQL:-psql}"
ADMIN_URL="${POSTGRES_ADMIN_URL:-postgres://postgres@localhost:5432/postgres}"

$PSQL "$ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'norbius_owner') THEN
    CREATE ROLE norbius_owner LOGIN PASSWORD 'norbius_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'norbius_app') THEN
    CREATE ROLE norbius_app LOGIN PASSWORD 'norbius_app';
  ELSE
    ALTER ROLE norbius_app LOGIN PASSWORD 'norbius_app';
  END IF;
  -- Painel admin (Fase 7): papel próprio, sem acesso a dados financeiros (ADR 0007).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'norbius_admin') THEN
    CREATE ROLE norbius_admin LOGIN PASSWORD 'norbius_admin';
  ELSE
    ALTER ROLE norbius_admin LOGIN PASSWORD 'norbius_admin';
  END IF;
END \$\$;
SQL

if ! $PSQL "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  $PSQL "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME OWNER norbius_owner"
fi
echo "Banco '$DB_NAME' pronto (owner: norbius_owner, app: norbius_app, admin: norbius_admin)."
