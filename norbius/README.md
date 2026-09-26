# NORBIUS

> Seu dinheiro. Uma inteligência trabalhando por você.

Sistema de inteligência financeira pessoal (SaaS, pt-BR). Arquitetura completa em [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md); decisões da fundação em [`docs/adr/0001-fundacao.md`](docs/adr/0001-fundacao.md).

**Status:** Fase 1 — Foundation.

## Estrutura

```
apps/
  api/      Fastify — /api/auth/* (Better Auth) e /api/v1/*
  web/      Next.js 16 — marketing, autenticação e área logada (BFF: /api/* → API)
packages/
  db/             schema Drizzle, migrações SQL, RLS, withUserContext
  contracts/      schemas Zod compartilhados entre web e API
  ui/             design system NORBIUS (tokens, componentes, NORBIUS CORE)
  observability/  logger pino com redaction de dados sensíveis
infra/            banco local, docker-compose
```

## Rodando localmente

Requisitos: Node 22+, pnpm 10, PostgreSQL 16 e Redis (ou `docker compose -f infra/docker-compose.yml up -d`).

```bash
pnpm install
cp .env.example .env            # gere BETTER_AUTH_SECRET: openssl rand -base64 48
POSTGRES_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm db:setup
DATABASE_MIGRATION_URL=postgres://norbius_owner:norbius_owner@localhost:5432/norbius pnpm db:migrate
pnpm dev                        # web em :3000, API em :4000
```

Sem `RESEND_API_KEY`, os e-mails (verificação, redefinição de senha) aparecem no log da API.

## Testes

```bash
pnpm typecheck
pnpm test                                          # unitários + integração (Postgres real) + isolamento RLS
API_URL=http://localhost:4100 pnpm --filter @norbius/web build && pnpm test:e2e   # Playwright
```

## Regras do projeto

- Toda tabela de dados do usuário tem RLS e é acessada via `withUserContext`; o `userId` vem sempre da sessão.
- Nenhum dado mockado apresentado como real; nenhum botão sem função.
- Valores monetários em centavos (`bigint`), nunca `float`.
- Nova tabela = privilégios concedidos explicitamente na migração.
