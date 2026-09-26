# NORBIUS

> Seu dinheiro. Uma inteligência trabalhando por você.

Sistema de inteligência financeira pessoal (SaaS, pt-BR). Arquitetura completa em [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md). Decisões: [fundação](docs/adr/0001-fundacao.md) · [núcleo financeiro](docs/adr/0002-nucleo-financeiro.md) · [NORBIUS AI](docs/adr/0003-norbius-ai.md) · [assinaturas](docs/adr/0004-assinaturas.md) · [inteligência financeira](docs/adr/0005-inteligencia-financeira.md).

**Status:** Fase 4 (inteligência financeira) concluída. A Fase 6 foi antecipada a pedido do dono do produto; as Fases 5 (experiência premium) e 7 (admin) ainda não foram iniciadas.

| Fase | Entregue |
|---|---|
| 1 · Foundation | Monorepo, banco com RLS, autenticação completa, design system, site, área logada |
| 2 · Financial Core | Onboarding conversacional, contas, transações, transferências, categorias, contas fixas/recorrências, cartões (parcelas, faturas, pagamento), metas, painel com dados reais, exportação CSV |
| 3 · NORBIUS AI | Assistente conversacional (Claude) com streaming: consultas com dados reais, registro por linguagem natural com Desfazer, ações sensíveis com confirmação, memórias explícitas, cota mensal, avaliação; modo voz (ditado, respostas faladas, ligação com voz neural local opcional) |
| 4 · Inteligência | Projeção de saldo p10/p50/p90 com premissas, "quanto posso gastar" até a próxima receita, 11 detectores de insights com evidência, estado real do NORBIUS CORE, alertas no painel e no assistente; avisos no app e por e-mail com preferências e horário silencioso; análise diária às 06:00 locais |
| 6 · SaaS | Planos Grátis/Pro (R$ 14,90/mês ou R$ 149/ano), teste de 7 dias sem cartão, assinatura via Asaas (Pix, boleto, cartão), webhook idempotente, limites por plano, cancelamento, histórico de cobranças |

## Estrutura

```
apps/
  api/      Fastify — /api/auth/* (Better Auth) e /api/v1/*
  web/      Next.js 16 — marketing, autenticação e área logada (BFF: /api/* → API)
packages/
  domain/         regras puras: dinheiro pt-BR, datas, parcelas, faturas, recorrências
  intelligence/   regras puras da Fase 4: projeção, safe-to-spend, detectores, estado do CORE
  db/             schema Drizzle, migrações SQL, RLS, withUserContext, qualified()
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

Sem `RESEND_API_KEY`, os e-mails (verificação, redefinição de senha, avisos) aparecem no log da API. A análise diária e o envio de avisos rodam dentro da API (`JOBS_ENABLED`, padrão `true`; com várias instâncias, ligue em só uma).

O assistente NORBIUS precisa de `ANTHROPIC_API_KEY` (modelo em `AI_MODEL`, padrão `claude-opus-5`). Sem a chave, a tela `/norbius` informa que o assistente não está ativo e o resto do app funciona normalmente.

Assinaturas usam o Asaas: `ASAAS_API_KEY`, `ASAAS_ENV` (`sandbox` ou `production`) e `ASAAS_WEBHOOK_TOKEN` (o mesmo token cadastrado no webhook do painel do Asaas, apontando para `https://<api>/api/v1/billing/webhooks/asaas`). Sem a chave, o teste grátis funciona e o checkout informa que o pagamento não está disponível.

## Testes

```bash
pnpm typecheck
pnpm test                                          # unitários + integração (Postgres real) + isolamento RLS
API_URL=http://localhost:4100 pnpm --filter @norbius/web build && pnpm test:e2e   # Playwright
ANTHROPIC_API_KEY=... pnpm --filter @norbius/api eval:ai   # avaliação do modelo real (tem custo)
```

## Regras do projeto

- Toda tabela de dados do usuário tem RLS e é acessada via `withUserContext`; o `userId` vem sempre da sessão.
- Referências entre tabelas do usuário usam FK composta `(user_id, id)`.
- Subconsultas correlacionadas usam `qualified(coluna)` (ver ADR 0002).
- Pagamento de fatura é transferência, não despesa (sem dupla contagem).
- Nenhum dado mockado apresentado como real; nenhum botão sem função.
- Valores monetários em centavos (`bigint`), nunca `float`.
- Nova tabela = privilégios concedidos explicitamente na migração.
- Acesso Pro só é liberado por pagamento confirmado via webhook; limites de plano são aplicados na API (ADR 0004).
- A IA nunca calcula nem inventa valores: todo número vem de uma tool; alterar, excluir e transferir exigem confirmação do usuário (ADR 0003).
