# NORBIUS — Blueprint Técnico (Fase 0)

> **Seu dinheiro. Uma inteligência trabalhando por você.**
>
> Documento de arquitetura da Fase 0. Nenhum código de produto foi escrito. A implementação só começa após autorização explícita para a **FASE 1 — Foundation**.

| Item | Valor |
|---|---|
| Produto | NORBIUS — Financial Intelligence System |
| Tipo | SaaS multi-tenant B2C, pt-BR, mercado brasileiro |
| Status | Blueprint (Fase 0) — aguardando aprovação |
| Data | 2026-09-26 |

---

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Stack tecnológica e justificativa](#2-stack-tecnológica-e-justificativa)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Modelo completo do banco](#4-modelo-completo-do-banco)
5. [Relacionamentos](#5-relacionamentos)
6. [Fluxos de autenticação](#6-fluxos-de-autenticação)
7. [Fluxo de onboarding](#7-fluxo-de-onboarding)
8. [Fluxo do dashboard](#8-fluxo-do-dashboard)
9. [Arquitetura do NORBIUS AI](#9-arquitetura-do-norbius-ai)
10. [Tools da IA](#10-tools-da-ia)
11. [Sistema de memória](#11-sistema-de-memória)
12. [Sistema de projeções](#12-sistema-de-projeções)
13. [Sistema de insights](#13-sistema-de-insights)
14. [Sistema de assinatura](#14-sistema-de-assinatura)
15. [Arquitetura do painel admin](#15-arquitetura-do-painel-admin)
16. [Segurança](#16-segurança)
17. [Privacidade (LGPD)](#17-privacidade-lgpd)
18. [Observabilidade](#18-observabilidade)
19. [Plano de testes](#19-plano-de-testes)
20. [Roadmap por fases](#20-roadmap-por-fases)
21. [Dependências](#21-dependências)
22. [Variáveis de ambiente](#22-variáveis-de-ambiente)
23. [Estratégia de deploy](#23-estratégia-de-deploy)
24. [Futura integração Open Finance](#24-futura-integração-open-finance)
25. [Decisões pendentes](#25-decisões-pendentes-para-o-dono-do-produto)

---

## 1. Visão geral da arquitetura

### 1.1 Princípios

1. **Determinístico onde há dinheiro, generativo onde há linguagem.** Todo número exibido (saldo, totais, projeções) vem de SQL/código determinístico. O LLM **nunca calcula**: ele interpreta a intenção, chama tools e redige a resposta a partir do resultado dessas tools.
2. **Isolamento por usuário em três camadas:** sessão autenticada → `user_id` injetado pelo servidor (nunca vindo do cliente ou do modelo) → Row Level Security no PostgreSQL.
3. **Domínio único, múltiplas entradas.** Transação criada pela UI, pelo chat, por importação ou (no futuro) pelo Open Finance passa pelo **mesmo** `TransactionService`. Nada de lógica duplicada.
4. **Honestidade de dados.** Sem mocks em produção. Estados vazios são estados vazios. Estimativas são rotuladas como estimativas em todo lugar (API, UI e IA).
5. **Modular e evolutivo.** Módulos de domínio com fronteiras claras (`accounts`, `transactions`, `cards`, `goals`, `intelligence`, `ai`, `billing`, `notifications`, `admin`), prontos para virar serviços separados se necessário, mas começando como um *modular monolith*.

### 1.2 Diagrama de alto nível

```
                         ┌────────────────────────────────────────┐
                         │               Clientes                  │
                         │  Browser (desktop/mobile) · futuro app  │
                         └───────────────┬────────────────────────┘
                                         │ HTTPS
        ┌────────────────────────────────┼─────────────────────────────────┐
        │                                │                                 │
┌───────▼────────┐             ┌─────────▼─────────┐             ┌─────────▼─────────┐
│ apps/web       │             │ apps/web (app)    │             │ apps/admin        │
│ Marketing      │             │ Área logada       │             │ Painel admin      │
│ norbius.com.br │             │ app.norbius…      │             │ admin.norbius…    │
│ (SSG/ISR)      │             │ Next.js (BFF)     │             │ Next.js, auth     │
└────────────────┘             └─────────┬─────────┘             │ separada + MFA    │
                                         │ /api/* (proxy          └─────────┬─────────┘
                                         │ mesma origem)                    │
                               ┌─────────▼──────────────────────────────────▼──┐
                               │                 apps/api (Fastify)            │
                               │  Auth · Validation · Rate limit · RBAC        │
                               │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
                               │  │ Financial│ │ AI       │ │ Billing       │  │
                               │  │ Core     │ │ Orchestr.│ │ (Stripe adap.)│  │
                               │  └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
                               │  ┌────▼────────────▼──────────────▼────────┐  │
                               │  │ Services → Repositories (Drizzle + RLS) │  │
                               │  └────────────────────┬────────────────────┘  │
                               └──────────┬────────────┼───────────────────────┘
                                          │            │
                ┌─────────────────────────┤            │ enfileira jobs
                │                         │            │
       ┌────────▼────────┐      ┌─────────▼──────┐  ┌──▼─────────────────────┐
       │ PostgreSQL 16   │      │ Redis          │  │ apps/worker (BullMQ)   │
       │ (sa-east-1)     │      │ rate limit,    │  │ insights, projeções,   │
       │ RLS, PITR       │      │ filas, cache   │  │ recorrências, notific.,│
       └─────────────────┘      └────────────────┘  │ relatórios PDF, e-mail │
                                                    └──┬──────────────┬──────┘
                                                       │              │
                                        ┌──────────────▼──┐   ┌───────▼────────┐
                                        │ Anthropic API   │   │ Resend (email) │
                                        │ (Claude)        │   │ Stripe (billing)│
                                        └─────────────────┘   └────────────────┘
```

### 1.3 Camadas do produto → módulos técnicos

| Camada do produto | Onde vive | Módulo |
|---|---|---|
| Marketing Website | `apps/web` rotas `(marketing)` | estático, SSG |
| Authentication | `apps/api` + `packages/auth` | Better Auth |
| Onboarding | `apps/web` `(app)/onboarding` + `api/modules/onboarding` | máquina de estados |
| Financial Core | `api/modules/{accounts,transactions,categories,recurring}` | domínio |
| Credit Cards | `api/modules/cards` | domínio |
| Goals | `api/modules/goals` | domínio |
| AI Assistant | `api/modules/ai` | orquestrador + tools |
| Financial Intelligence | `packages/intelligence` + `worker` | engine determinística |
| Dashboard | `apps/web` `(app)/dashboard` + `api/modules/dashboard` | agregação |
| Reports | `api/modules/reports` + `worker` | PDF/CSV |
| Notifications | `api/modules/notifications` + `worker` | in-app + e-mail |
| Subscription | `api/modules/billing` | Stripe adapter |
| Admin | `apps/admin` + `api/modules/admin` | RBAC separado |
| Security / Observability | `packages/observability`, middlewares | transversal |

---

## 2. Stack tecnológica e justificativa

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | **TypeScript** (strict) ponta a ponta | Um só idioma de tipos entre front, API, worker e validação; schemas Zod compartilhados. |
| Monorepo | **pnpm workspaces + Turborepo** | Apps separados (web/api/worker/admin) com pacotes compartilhados, cache de build no CI. |
| Frontend | **Next.js 16 (App Router) + React 19** (atualizado na Fase 1, ver ADR 0001) | SSG para marketing (SEO), RSC para a área logada, streaming de UI. Atua como BFF: faz proxy de `/api/*` para a API (mesma origem → cookies `SameSite=Lax`, sem CORS). |
| UI | **Tailwind CSS v4 + Radix UI primitives (via shadcn/ui, totalmente re-temado)** + **Motion** (Framer Motion) | Componentes acessíveis sem herdar visual genérico; tokens próprios do NORBIUS; microinterações do NORBIUS CORE. |
| Gráficos | **visx** (ou Recharts para gráficos simples) | Controle fino de estética premium (fluxo, categorias, projeção com banda de incerteza). |
| Estado/dados no cliente | **TanStack Query** | Cache, invalidação após mutações, *optimistic updates* com rollback. |
| Formulários | **React Hook Form + Zod** | Mesmos schemas do backend. |
| API | **Fastify 5 + zod type provider + OpenAPI** | Rápido, tipado, plugins maduros (rate limit, helmet, cookies). API separada permite app mobile, webhooks de billing e Open Finance sem acoplar ao Next. |
| ORM / migrações | **Drizzle ORM + drizzle-kit** | SQL explícito, excelente com RLS (`set_config` por transação), migrações versionadas em SQL revisável. |
| Banco | **PostgreSQL 16** gerenciado (Neon, Supabase ou RDS) em **sa-east-1 (São Paulo)** | Relacional, RLS, JSONB, `numeric`/`bigint`, PITR. Região BR por latência e LGPD. |
| Autenticação | **Better Auth** (self-hosted, sessões no nosso banco) | E-mail/senha, Google OAuth, verificação de e-mail, reset de senha, 2FA, sessões revogáveis — sem terceirizar dados de usuário para um IdP externo. |
| Filas / jobs | **BullMQ + Redis** | Jobs de insights, projeções, recorrências, notificações, PDFs; retries e agendamento (cron). |
| Rate limit / cache | **Redis** (Upstash ou gerenciado) | Rate limiting distribuído por usuário/IP/rota; cache de snapshots do dashboard. |
| IA | **Anthropic Claude API** (SDK `@anthropic-ai/sdk`) com *tool use* nativo e streaming | `claude-sonnet-5` para o chat principal; `claude-haiku-4-5-20251001` para roteamento barato, sumarização de conversa e redação de insights. Modelo configurável por env. |
| Billing | **Stripe** (Checkout, Billing Portal, webhooks) atrás de uma interface `BillingProvider` | Assinatura em BRL com cartão. A interface permite adicionar Asaas/Pagar.me para Pix Automático/boleto sem reescrever. |
| E-mail | **Resend + React Email** | Templates transacionais versionados em código. |
| PDF | **@react-pdf/renderer** no worker | Relatórios com a identidade visual, gerados server-side. |
| Observabilidade | **Sentry** (erros + performance), **OpenTelemetry** (traces), **pino** (logs JSON com redaction) | Rastreamento ponta a ponta incluindo chamadas ao LLM. |
| Product analytics | **PostHog** (instância EU ou self-host), eventos sem PII financeira | DAU/WAU/MAU, funil de onboarding, conversão, retenção. |
| Testes | **Vitest**, **Testcontainers** (Postgres real), **Playwright**, **k6**, suíte de *evals* da IA | Ver §19. |
| CI/CD | **GitHub Actions** | Lint, typecheck, testes, migrações, deploy por ambiente. |

**Alternativa considerada e descartada:** monólito Next.js com Route Handlers + Supabase Auth. Mais rápido de iniciar, porém acopla backend ao frontend, dificulta worker/admin separados e aumenta o risco de lógica de negócio vazar para componentes. O custo extra do monorepo é pequeno e pago uma única vez na Fase 1.

**Dinheiro:** todos os valores são armazenados como **inteiros em centavos (`bigint`)** + `currency char(3) default 'BRL'`. Nunca `float`. Formatação `pt-BR` apenas na borda (UI/IA).

**Datas:** `timestamptz` em UTC no banco; datas de competência financeira como `date`. Fuso do usuário (`America/Sao_Paulo` por padrão) salvo no perfil e usado em todos os cortes de período.

---

## 3. Estrutura de pastas

```
norbius/
├── apps/
│   ├── web/                          # Next.js — marketing + app do usuário
│   │   ├── app/
│   │   │   ├── (marketing)/          # /, /precos, /faq, /privacidade, /termos
│   │   │   ├── (auth)/               # /entrar, /cadastro, /recuperar-senha, /verificar-email
│   │   │   ├── (app)/                # área protegida (middleware de sessão)
│   │   │   │   ├── onboarding/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── norbius/          # chat com o assistente
│   │   │   │   ├── transacoes/
│   │   │   │   ├── contas/
│   │   │   │   ├── cartoes/
│   │   │   │   ├── metas/
│   │   │   │   ├── relatorios/
│   │   │   │   ├── notificacoes/
│   │   │   │   ├── assinatura/
│   │   │   │   └── configuracoes/    # perfil, segurança, privacidade, memórias da IA, exportar/excluir dados
│   │   │   └── api/[...proxy]/       # proxy fino para apps/api (mesma origem)
│   │   ├── components/               # componentes de feature (usam packages/ui)
│   │   ├── features/                 # hooks + queries por domínio (TanStack Query)
│   │   └── middleware.ts             # proteção de rotas
│   │
│   ├── api/                          # Fastify — API REST /v1
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── plugins/              # auth, rls-context, rate-limit, error-handler, idempotency, otel
│   │   │   ├── modules/
│   │   │   │   ├── accounts/         # *.routes.ts · *.controller.ts · *.service.ts · *.repository.ts · *.schemas.ts
│   │   │   │   ├── transactions/
│   │   │   │   ├── categories/
│   │   │   │   ├── recurring/
│   │   │   │   ├── cards/
│   │   │   │   ├── goals/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── intelligence/     # endpoints de insights, projeções, core-state
│   │   │   │   ├── ai/
│   │   │   │   │   ├── orchestrator.ts
│   │   │   │   │   ├── context-builder.ts
│   │   │   │   │   ├── prompts/
│   │   │   │   │   ├── tools/        # uma tool por arquivo, cada uma chama um service de domínio
│   │   │   │   │   ├── pending-actions.ts
│   │   │   │   │   └── memory/
│   │   │   │   ├── reports/
│   │   │   │   ├── notifications/
│   │   │   │   ├── billing/
│   │   │   │   │   └── providers/stripe.ts
│   │   │   │   ├── privacy/          # exportação e exclusão (LGPD)
│   │   │   │   ├── support/
│   │   │   │   ├── admin/
│   │   │   │   └── integrations/     # futuro Open Finance (interfaces já definidas)
│   │   │   └── lib/                  # errors, pagination, money, dates
│   │   └── test/
│   │
│   ├── worker/                       # BullMQ — jobs assíncronos e cron
│   │   └── src/jobs/                 # recompute-insights, project-balance, materialize-recurring,
│   │                                 # close-card-invoices, send-notifications, render-report,
│   │                                 # purge-deleted-users, summarize-conversations
│   │
│   └── admin/                        # Next.js — painel administrativo (deploy e domínio separados)
│
├── packages/
│   ├── db/                           # schema Drizzle, migrações SQL, políticas RLS, seeds (categorias do sistema)
│   ├── contracts/                    # schemas Zod + tipos da API (fonte única para web/api/admin)
│   ├── domain/                       # regras puras: money, parcelas, faturas, períodos, saldos
│   ├── intelligence/                 # detectores de insights, engine de projeção, estado do CORE (puro, testável)
│   ├── auth/                         # config Better Auth compartilhada
│   ├── ui/                           # design system NORBIUS (tokens, componentes, NORBIUS CORE)
│   ├── emails/                       # templates React Email
│   ├── observability/                # logger pino, OTel, Sentry, redaction
│   └── config/                       # eslint, tsconfig, tailwind preset
│
├── evals/                            # conjuntos de avaliação da IA (pt-BR) + runner
├── infra/                            # docker-compose (dev), IaC, scripts de backup/restore
├── docs/                             # ADRs, runbooks, este blueprint
└── .github/workflows/
```

**Regra de dependência (verificada por lint):** `apps/*` → `packages/*`; `packages/domain` e `packages/intelligence` não importam nada de infraestrutura (sem DB, sem HTTP); `controllers` → `services` → `repositories`. Tools da IA só chamam `services`, nunca repositórios diretamente.

---

## 4. Modelo completo do banco

Convenções aplicadas a **todas** as tabelas de domínio:

- `id uuid primary key default gen_random_uuid()` (UUID v7 gerado na aplicação quando ordenação temporal for útil).
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger).
- Tabelas do usuário têm `user_id uuid not null references users(id) on delete cascade` + **política RLS** `user_id = current_setting('app.user_id')::uuid`.
- Valores monetários: `*_cents bigint` com `check` de sinal; `currency char(3) not null default 'BRL'`.
- Exclusão de dados financeiros: *soft delete* (`deleted_at`) para permitir "desfazer" e auditoria; purga física no fluxo LGPD.
- Enums como `text` + `check` (migração mais simples que `enum` nativo).

### 4.1 Identidade e perfil

```
users                                   -- gerenciada pelo Better Auth (+ colunas nossas)
  id uuid pk
  email citext unique not null
  email_verified boolean not null default false
  name text
  image text
  status text not null default 'active'   check in ('active','suspended','pending_deletion','deleted')
  last_seen_at timestamptz
  deletion_requested_at timestamptz
  created_at, updated_at

sessions            -- Better Auth: id, user_id fk, token_hash unique, expires_at, ip, user_agent, created_at
auth_accounts       -- Better Auth: id, user_id fk, provider_id ('credential'|'google'), account_id, password_hash, tokens (cifrados)
verifications       -- Better Auth: id, identifier, value_hash, expires_at  (verificação de e-mail, reset de senha)
two_factor          -- Better Auth: user_id fk, secret (cifrado), backup_codes (hash)

profiles
  user_id uuid pk fk users
  display_name text                        -- "Nome" do onboarding
  timezone text not null default 'America/Sao_Paulo'
  locale text not null default 'pt-BR'
  avg_monthly_income_cents bigint check (>= 0)       -- renda média declarada (dado declarado, não calculado)
  income_frequency text check in ('monthly','biweekly','weekly','irregular')
  income_days smallint[]                   -- ex.: {5,20}
  onboarding_status text not null default 'not_started' check in ('not_started','in_progress','completed','skipped')
  onboarding_step text
  onboarding_completed_at timestamptz
  preferences jsonb not null default '{}'  -- tema, notificações resumidas, etc.
  created_at, updated_at
```

### 4.2 Núcleo financeiro

```
accounts
  id, user_id
  name text not null
  type text not null check in ('checking','savings','wallet','investment','other')
  institution_name text
  initial_balance_cents bigint not null default 0      -- "Saldo inicial" do onboarding
  initial_balance_date date not null
  currency char(3) not null default 'BRL'
  include_in_available_balance boolean not null default true   -- investimento pode ficar de fora do "Saldo disponível"
  archived_at timestamptz
  -- compatibilidade Open Finance
  source text not null default 'manual' check in ('manual','open_finance','import')
  external_account_id uuid null fk external_accounts
  created_at, updated_at
  index (user_id) where archived_at is null

categories
  id
  user_id uuid null fk users                -- null = categoria do sistema
  name text not null
  kind text not null check in ('income','expense','both')
  system_key text null                      -- 'alimentacao','moradia','transporte','saude','educacao','lazer',
                                            -- 'compras','assinaturas','contas','investimentos','salario','outros'
  parent_id uuid null fk categories         -- subcategorias futuras
  icon text, color text
  archived_at timestamptz
  unique (user_id, name)
  -- RLS: SELECT permite user_id is null OR user_id = atual; escrita só user_id = atual

transactions
  id, user_id
  account_id uuid not null fk accounts
  type text not null check in ('income','expense','transfer')
  amount_cents bigint not null check (amount_cents > 0)      -- sempre positivo; o type define o sinal
  currency char(3) not null default 'BRL'
  category_id uuid null fk categories                        -- obrigatório para income/expense (check), null em transfer
  description text not null
  date date not null                                          -- data de competência
  status text not null default 'posted' check in ('posted','scheduled')   -- scheduled = conta futura materializada
  payment_method text null check in ('pix','debit','cash','boleto','transfer','credit_card_invoice','other')
  recurring boolean not null default false
  recurring_transaction_id uuid null fk recurring_transactions
  transfer_account_id uuid null fk accounts                   -- conta de destino (transfer entre contas)
  credit_card_invoice_id uuid null fk credit_card_invoices    -- pagamento de fatura (transfer para o passivo do cartão)
  notes text null                                             -- cifrado em nível de aplicação
  source text not null default 'manual' check in ('manual','ai','onboarding','import','open_finance','system')
  ai_message_id uuid null fk ai_messages                      -- rastreabilidade: qual mensagem criou
  external_provider text null, external_id text null          -- dedup Open Finance/import
  deleted_at timestamptz null
  created_at, updated_at
  check (type <> 'transfer' or (transfer_account_id is not null or credit_card_invoice_id is not null))
  check (type = 'transfer' or category_id is not null)
  unique (user_id, external_provider, external_id) where external_id is not null
  index (user_id, date desc) where deleted_at is null
  index (user_id, account_id, date desc)
  index (user_id, category_id, date)
  index gin (to_tsvector('portuguese', description))          -- busca

recurring_transactions                                        -- despesas fixas, salário, assinaturas
  id, user_id
  account_id uuid null fk accounts
  credit_card_id uuid null fk credit_cards                    -- assinatura cobrada no cartão
  type text not null check in ('income','expense')
  amount_cents bigint not null check (> 0)
  amount_is_estimate boolean not null default false           -- ex.: conta de luz varia
  category_id uuid not null fk categories
  description text not null
  frequency text not null check in ('weekly','biweekly','monthly','yearly')
  day_of_month smallint null check (between 1 and 31)
  start_date date not null
  end_date date null
  next_occurrence_date date not null
  auto_post boolean not null default false                    -- lançar automaticamente como posted? default: não (fica 'scheduled')
  detected_by text not null default 'user' check in ('user','intelligence')
  active boolean not null default true
  created_at, updated_at
  check (num_nonnulls(account_id, credit_card_id) = 1)
  index (user_id, next_occurrence_date) where active
```

**Saldo de conta** = `initial_balance + Σ income − Σ expense − Σ transfers saindo + Σ transfers entrando` (apenas `posted`, não deletadas). Calculado por uma view (`account_balances`) com índices; se necessário, cache em Redis invalidado a cada escrita. Nunca um campo "saldo" editável solto.

### 4.3 Cartões de crédito

**Decisão importante:** gasto no cartão é contabilizado **na compra** (análise de categorias/insights), enquanto o **pagamento da fatura** é um `transfer` da conta para o cartão — reduz o saldo da conta, mas **não** conta como despesa de novo. Isso evita dupla contagem, o erro mais comum de apps financeiros.

```
credit_cards
  id, user_id
  name text not null                       -- "Nubank", "Itaú Platinum"
  brand text null                          -- visa, mastercard, elo...
  last_four char(4) null                   -- opcional; nunca o número completo
  limit_cents bigint not null check (>= 0)
  closing_day smallint not null check (1..31)
  due_day smallint not null check (1..31)
  default_payment_account_id uuid null fk accounts
  archived_at timestamptz
  source text not null default 'manual', external_account_id uuid null
  created_at, updated_at

credit_card_invoices
  id, user_id
  credit_card_id uuid not null fk credit_cards
  reference_month date not null            -- 1º dia do mês de referência
  closing_date date not null
  due_date date not null
  status text not null default 'open' check in ('open','closed','paid','partially_paid','overdue')
  paid_cents bigint not null default 0
  unique (credit_card_id, reference_month)
  -- total = Σ credit_card_transactions da fatura (view credit_card_invoice_totals)

credit_card_purchases                      -- a compra "lógica" (ex.: 10x de R$ 120)
  id, user_id
  credit_card_id uuid not null fk credit_cards
  description text not null
  total_amount_cents bigint not null check (> 0)
  installment_count smallint not null default 1 check (1..48)
  purchase_date date not null
  category_id uuid not null fk categories
  recurring_transaction_id uuid null fk recurring_transactions   -- assinatura no cartão
  source text not null default 'manual', ai_message_id uuid null
  external_provider text null, external_id text null
  deleted_at timestamptz

credit_card_transactions                   -- cada parcela, alocada em uma fatura
  id, user_id
  purchase_id uuid not null fk credit_card_purchases on delete cascade
  credit_card_id uuid not null fk credit_cards
  invoice_id uuid not null fk credit_card_invoices
  installment_number smallint not null
  amount_cents bigint not null check (> 0)       -- arredondamento: centavos restantes na 1ª parcela
  category_id uuid not null fk categories
  competence_date date not null
  unique (purchase_id, installment_number)
  index (user_id, invoice_id)
```

**Limite disponível** = `limit − Σ parcelas em faturas não pagas (open/closed/overdue) − Σ parcelas futuras`. A regra de alocação de parcela → fatura (data da compra vs. `closing_day`, meses curtos, dia 31) mora em `packages/domain/cards` com testes exaustivos.

### 4.4 Metas

```
goals
  id, user_id
  name text not null
  target_amount_cents bigint not null check (> 0)
  current_amount_cents bigint not null default 0 check (>= 0)   -- mantido pela soma de goal_contributions (trigger)
  target_date date null
  linked_account_id uuid null fk accounts   -- opcional: meta "espelhada" em uma poupança
  status text not null default 'active' check in ('active','completed','paused','archived')
  completed_at timestamptz
  created_at, updated_at

goal_contributions                          -- "Aportes" + "Histórico"
  id, user_id
  goal_id uuid not null fk goals on delete cascade
  amount_cents bigint not null              -- negativo = retirada
  date date not null
  transaction_id uuid null fk transactions  -- se o aporte movimentou dinheiro de verdade
  note text
  source text not null default 'manual'
  created_at
```

### 4.5 Inteligência

```
insights
  id, user_id
  type text not null        -- 'category_increase','anomaly','recurring_detected','bill_due','card_limit',
                            -- 'goal_off_track','spending_pace','projected_negative','monthly_summary'
  severity text not null check in ('info','opportunity','attention','critical')
  title text not null, body text not null           -- texto final exibido (determinístico ou redigido pela IA a partir de evidence)
  evidence jsonb not null                           -- números e ids que sustentam o insight (auditável)
  fingerprint text not null                         -- dedup: type + escopo + período
  period_start date, period_end date
  status text not null default 'open' check in ('open','seen','dismissed','resolved','expired')
  expires_at timestamptz
  created_at, updated_at
  unique (user_id, fingerprint)

projection_snapshots                                -- cache e histórico das projeções
  id, user_id
  horizon_end date not null
  generated_at timestamptz not null
  inputs_hash text not null
  method_version text not null
  result jsonb not null                             -- série diária p10/p50/p90 + premissas
  confidence text not null check in ('low','medium','high')

core_state_events                                   -- histórico de estado do NORBIUS CORE
  id, user_id
  state text not null check in ('ACTIVE','ANALYZING','STABLE','ATTENTION','OPTIMIZING')
  reasons jsonb not null                            -- ex.: [{"insight_id": "...", "type": "bill_due"}]
  created_at
```

### 4.6 IA

```
ai_conversations
  id, user_id
  title text
  summary text null                   -- resumo rolante (cifrado)
  summary_upto_message_id uuid null
  last_message_at timestamptz
  archived_at timestamptz

ai_messages
  id, user_id
  conversation_id uuid not null fk ai_conversations on delete cascade
  role text not null check in ('user','assistant','tool')
  content text not null               -- cifrado
  tool_calls jsonb null               -- nome, input validado, resultado resumido
  model text null
  input_tokens int, output_tokens int, cache_read_tokens int
  latency_ms int
  created_at
  index (conversation_id, created_at)

ai_pending_actions                    -- ações que exigem confirmação do usuário
  id, user_id
  conversation_id uuid fk, message_id uuid fk
  tool_name text not null
  payload jsonb not null              -- input já validado pelo schema da tool
  preview jsonb not null              -- o que a UI mostra no cartão de confirmação
  status text not null default 'pending' check in ('pending','confirmed','rejected','expired','executed','failed')
  expires_at timestamptz not null     -- ex.: 15 min
  executed_result jsonb null
  created_at, updated_at

ai_memories                           -- memória de longo prazo, visível e editável pelo usuário
  id, user_id
  kind text not null check in ('preference','fact','context')
  content text not null               -- ex.: "Prefere respostas curtas", "Recebe salário no dia 5"
  source_message_id uuid null fk ai_messages
  confidence text not null default 'stated' check in ('stated','inferred')
  last_used_at timestamptz
  deleted_at timestamptz
  created_at

ai_usage                              -- medição para limites de plano e custo
  user_id uuid fk, period_month date, messages_count int, input_tokens bigint, output_tokens bigint, cost_micro_usd bigint
  primary key (user_id, period_month)
```

### 4.7 Notificações, relatórios, suporte

```
notifications
  id, user_id
  type text not null   -- 'bill_due','goal_reached','unusual_spending','card_limit','financial_summary','insight'
  title text, body text
  data jsonb            -- links (insight_id, invoice_id...)
  channel text not null check in ('in_app','email','push')
  status text not null default 'pending' check in ('pending','sent','read','failed')
  scheduled_for timestamptz, sent_at timestamptz, read_at timestamptz
  dedup_key text, unique (user_id, dedup_key)

notification_preferences
  user_id uuid, type text, in_app boolean, email boolean, push boolean
  primary key (user_id, type)

reports
  id, user_id
  kind text check in ('monthly','yearly','custom'), period_start date, period_end date
  format text check in ('pdf','csv')
  status text check in ('queued','ready','failed','expired')
  storage_key text          -- objeto privado no storage, URL assinada de curta duração
  expires_at timestamptz

support_tickets
  id, user_id null, kind text check in ('contact','bug','feedback'), subject text, body text, status text, created_at
```

### 4.8 SaaS / billing

```
plans
  id text pk               -- 'free','pro'
  name text, price_cents bigint, currency char(3), interval text check in ('month','year')
  provider_price_id text   -- Stripe price
  entitlements jsonb       -- {"ai_messages_per_month": 30, "projections": false, "reports": false, "advanced_insights": false}
  active boolean

subscriptions
  id, user_id unique
  plan_id text fk plans
  status text check in ('trialing','active','past_due','canceled','incomplete','paused')
  provider text not null default 'stripe'
  provider_customer_id text, provider_subscription_id text unique
  current_period_start timestamptz, current_period_end timestamptz
  cancel_at_period_end boolean default false
  trial_end timestamptz null
  canceled_at timestamptz null

payments
  id, user_id
  subscription_id uuid fk
  provider_payment_id text unique
  amount_cents bigint, currency char(3)
  status text check in ('succeeded','failed','refunded','pending')
  paid_at timestamptz, invoice_url text

billing_events                           -- log idempotente de webhooks
  id text pk (id do evento no provedor), provider text, type text, payload jsonb,
  processed_at timestamptz, error text
```

### 4.9 Segurança, auditoria, privacidade, admin

```
audit_logs                               -- append-only (sem UPDATE/DELETE por grant)
  id bigserial pk
  actor_type text check in ('user','admin','system','ai')
  actor_id uuid null
  subject_user_id uuid null
  action text not null                   -- 'transaction.create','ai.action.confirm','admin.user.view','auth.login.failed'...
  entity_type text, entity_id uuid
  metadata jsonb                         -- sem valores financeiros sensíveis desnecessários
  ip inet, user_agent text
  request_id text
  created_at timestamptz not null default now()
  index (subject_user_id, created_at), index (action, created_at)

consents
  id, user_id, kind text ('terms','privacy','marketing_email','ai_processing'), version text,
  granted boolean, granted_at timestamptz, ip inet

data_requests                            -- LGPD: exportação / exclusão
  id, user_id, kind text check in ('export','delete'), status text, requested_at, completed_at, storage_key text

admin_users                              -- identidade SEPARADA dos usuários finais
  id, email citext unique, name, role text check in ('support','billing','analyst','superadmin'),
  password_hash, totp_secret (cifrado) not null, webauthn jsonb, active boolean, last_login_at

admin_sessions                           -- id, admin_user_id, token_hash, expires_at (curta), ip, user_agent

support_access_grants                    -- acesso excepcional autorizado PELO USUÁRIO
  id, user_id, admin_user_id null, scope text[] ('transactions:read', ...),
  reason text not null, granted_by_user_at timestamptz, expires_at timestamptz not null, revoked_at timestamptz
```

### 4.10 Open Finance (estrutura pronta, sem implementação na v1)

```
financial_institutions   -- id, name, code (ISPB/COMPE), logo_url
external_connections     -- id, user_id, provider ('pluggy','belvo',...), provider_item_id, institution_id,
                         -- status ('active','login_error','consent_expired','revoked'), consent_expires_at,
                         -- credentials_ref (cifrado/segredo no provedor), last_synced_at
external_accounts        -- id, user_id, connection_id, provider_account_id, type, name, mask, currency
external_raw_transactions-- id, user_id, connection_id, provider_transaction_id, payload jsonb, received_at,
                         -- normalized_transaction_id uuid null, unique(connection_id, provider_transaction_id)
```

---

## 5. Relacionamentos

```mermaid
erDiagram
  users ||--|| profiles : tem
  users ||--o{ sessions : autentica
  users ||--o{ accounts : possui
  users ||--o{ categories : "cria (custom)"
  users ||--o{ transactions : registra
  users ||--o{ recurring_transactions : agenda
  users ||--o{ credit_cards : possui
  users ||--o{ goals : define
  users ||--o{ insights : recebe
  users ||--o{ notifications : recebe
  users ||--o{ ai_conversations : conversa
  users ||--o{ ai_memories : lembra
  users ||--|| subscriptions : assina
  users ||--o{ payments : paga
  users ||--o{ consents : consente

  accounts ||--o{ transactions : "origem"
  accounts ||--o{ transactions : "destino (transfer)"
  categories ||--o{ transactions : classifica
  recurring_transactions ||--o{ transactions : gera

  credit_cards ||--o{ credit_card_invoices : fatura
  credit_cards ||--o{ credit_card_purchases : compra
  credit_card_purchases ||--|{ credit_card_transactions : "parcelas"
  credit_card_invoices ||--o{ credit_card_transactions : contem
  credit_card_invoices ||--o{ transactions : "pago por (transfer)"

  goals ||--o{ goal_contributions : aporte
  transactions |o--o| goal_contributions : "movimenta"

  ai_conversations ||--o{ ai_messages : contem
  ai_messages ||--o{ ai_pending_actions : propõe
  ai_messages |o--o{ transactions : "originou"

  plans ||--o{ subscriptions : define
  subscriptions ||--o{ payments : gera

  external_connections ||--o{ external_accounts : expõe
  external_accounts |o--o| accounts : "mapeia"
  external_connections ||--o{ external_raw_transactions : recebe
  external_raw_transactions |o--o| transactions : "normaliza em"
```

Regras de integridade além das FKs:

- **Pertencimento cruzado:** uma transação não pode referenciar conta/categoria/fatura de outro usuário. Garantido por FK composta `(user_id, account_id) → accounts(user_id, id)` (com `unique (user_id, id)` nas tabelas referenciadas) **e** por RLS. Isso fecha a classe inteira de bugs de acesso cruzado no nível do banco.
- `on delete cascade` de `users` para tudo que é do usuário (base para exclusão LGPD).
- Contas/cartões/categorias com histórico **não são excluídos**, são arquivados (`archived_at`).

---

## 6. Fluxos de autenticação

### 6.1 Cadastro (e-mail e senha)

```
Usuário → /cadastro (nome, e-mail, senha, aceite de Termos + Privacidade)
  → POST /v1/auth/sign-up
      · validação Zod · senha ≥ 10 caracteres, checagem contra lista de senhas vazadas (k-anonymity HIBP)
      · rate limit: 5/h por IP
      · hash Argon2id
      · cria users + profiles + subscription(plan=free) + consents (versão dos termos) em UMA transação
      · envia e-mail de verificação (token de uso único, 24h, armazenado como hash)
  → resposta idêntica se o e-mail já existir (evita enumeração de contas)
  → tela "Verifique seu e-mail"
Clique no link → /verificar-email?token → verifica → cria sessão → /onboarding
```

Usuário não verificado pode entrar, mas vê apenas a tela de verificação (reenviar com rate limit). Nada de dados financeiros antes da verificação.

### 6.2 Login

- E-mail/senha → sessão em cookie `__Host-norbius_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`), token opaco com hash no banco, expiração deslizante de 30 dias, absoluta de 90.
- Proteção: rate limit por IP e por e-mail (10 falhas/15 min → atraso progressivo + CAPTCHA Turnstile), mensagem genérica "e-mail ou senha inválidos", `audit_logs` para falhas e sucessos.
- 2FA (TOTP) opcional para usuários, **obrigatório para admins**.

### 6.3 Login com Google

OAuth 2.0 Authorization Code + PKCE + `state`. E-mail do Google verificado → vincula a um usuário existente com o mesmo e-mail **somente** se esse e-mail já estiver verificado localmente; caso contrário, exige login com senha antes de vincular (evita *account takeover*).

### 6.4 Recuperação de senha

`/recuperar-senha` → resposta sempre igual → e-mail com token de uso único (30 min, hash no banco) → nova senha → **revoga todas as sessões** → e-mail de aviso "sua senha foi alterada".

### 6.5 Logout e sessões

Logout revoga a sessão no banco (não só apaga o cookie). Em Configurações → Segurança: lista de sessões ativas (dispositivo, IP aproximado, último uso) com "encerrar" individual e "encerrar todas".

### 6.6 Proteção de rotas

1. `apps/web/middleware.ts`: sem cookie → redireciona para `/entrar?next=`. (checagem barata, não é a barreira de segurança)
2. Layout `(app)` server-side: valida sessão na API; `onboarding_status != completed` → `/onboarding`.
3. **API (barreira real):** plugin `auth` resolve a sessão em toda rota `/v1/*` exceto públicas; plugin `rls-context` abre transação e executa `select set_config('app.user_id', $1, true)`. Repositórios nunca recebem `user_id` do corpo da requisição.
4. CSRF: cookies `SameSite=Lax` + checagem de `Origin` em métodos mutáveis + token CSRF do Better Auth.

---

## 7. Fluxo de onboarding

**Formato:** conversa com o NORBIUS na UI (bolhas, digitação, *chips* de resposta rápida), mas **roteirizada por uma máquina de estados determinística** — não por LLM livre. Motivos: previsível, barato, rápido, testável e sem risco de a IA inventar dados na primeira impressão. Campos de texto livre ("uns 4 mil e pouco") são interpretados por um parser pt-BR de valores e, só se ele falhar, por uma chamada curta ao Haiku que devolve JSON validado.

| # | Etapa | Pergunta do NORBIUS (exemplo) | Entrada | Pular? | Persistência |
|---|---|---|---|---|---|
| 1 | Nome | "Olá. Eu sou o NORBIUS. Como prefere ser chamado?" | texto | não | `profiles.display_name` |
| 2 | Renda média | "Em média, quanto entra por mês?" | valor / "prefiro não dizer" | sim | `avg_monthly_income_cents` |
| 3 | Frequência | "Você recebe como?" mensal · quinzenal · semanal · variável (+ dias) | chips | sim | `income_frequency`, `income_days` → cria `recurring_transactions` de receita com `amount_is_estimate=true` se o usuário confirmar |
| 4 | Contas | "Onde fica seu dinheiro hoje?" chips de tipo + nome | lista | sim (cria "Carteira") | `accounts` |
| 5 | Cartões | "Usa cartão de crédito?" nome, limite, fechamento, vencimento | lista | sim | `credit_cards` |
| 6 | Despesas fixas | "Quais contas se repetem todo mês?" sugestões: aluguel, luz, internet, streaming… | lista | sim | `recurring_transactions` |
| 7 | Metas | "Tem algo que quer conquistar?" nome, valor, prazo | lista | sim | `goals` |
| 8 | Saldo inicial | "Quanto tem hoje em cada conta?" | valor por conta | sim (assume 0 e marca como não informado) | `accounts.initial_balance_cents` |

- Estado salvo a cada etapa (`profiles.onboarding_step`), retomável em qualquer dispositivo.
- "Pular tudo" leva ao dashboard com estados vazios guiados.
- **Conclusão:** endpoint `POST /v1/onboarding/complete` executa em uma transação: cria as entidades pendentes, marca `completed`, enfileira `recompute-intelligence`. O NORBIUS apresenta um **resumo inicial** construído só com o que foi informado: "Você tem 2 contas somando R$ X (informado por você), R$ Y em despesas fixas mensais e 1 meta. Com isso, a sobra estimada do mês é R$ Z — uma estimativa que ficará mais precisa conforme você registrar gastos." Se faltarem dados, ele diz exatamente quais.
- Eventos de analytics: `onboarding_started`, `onboarding_step_completed{step}`, `onboarding_step_skipped{step}`, `onboarding_completed`.

---

## 8. Fluxo do dashboard

### 8.1 Composição (hierarquia visual)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [N] NORBIUS         Dashboard · Transações · Cartões · Metas · Relatórios   ●│
├──────────────────────────────────────────────────────────────────────────────┤
│  Boa noite, Ana.                                   ┌─────────────────────────┐│
│  Saldo disponível                                  │     NORBIUS CORE        ││
│  R$ 8.420,15                                       │        ◉  STABLE        ││
│  ─ Receitas R$ 6.200 ─ Despesas R$ 3.914 ─ Inv.    │  "Nenhum alerta. Sobra  ││
│                                                    │   estimada: R$ 1.230"   ││
│                                                    │  [ Falar com NORBIUS ]  ││
│                                                    └─────────────────────────┘│
│  Fluxo financeiro (real ── / projeção ┄┄ com banda)                           │
│  ▁▂▃▅▆▅▄▃▂▃▄▅▆▇┄┄┄┄┄┄                                                       │
│                                                                               │
│  Compromissos futuros      Categorias (mês)          Metas                    │
│  • Aluguel  05/10  R$1.800  Alimentação ████ 32%     Reserva ███░░ 62%        │
│  • Fatura   10/10  R$  940  Moradia     ███  24%     Viagem  █░░░░ 18%        │
│                                                                               │
│  Insights                                 Últimas transações                  │
│  ▲ Alimentação +28% vs. set (atenção)     Mercado      −R$ 50,00   hoje       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Preto domina; vermelho `#E50914` apenas em: CTA principal, estado ATTENTION do CORE, alertas críticos, destaque da linha de projeção negativa e foco. Verde `#22C55E` só para receita/meta atingida, âmbar `#F59E0B` só para avisos.

### 8.2 Fluxo de dados

1. RSC carrega `GET /v1/dashboard/summary?period=2026-09` (um único endpoint agregador: saldos, receitas/despesas do período, top categorias, próximos compromissos 30 dias, metas ativas, 5 últimas transações, insights abertos, estado do CORE). Resposta com campos `kind: "actual" | "estimate"` para cada número.
2. Gráfico de fluxo e projeção em rota separada (`/v1/intelligence/projection`), com *streaming/suspense* para não bloquear o resto.
3. Mutação em qualquer lugar (UI ou chat) → invalida queries `dashboard`, `transactions`, `accounts` no TanStack Query e enfileira `recompute-intelligence` (debounce de 30 s por usuário). O CORE passa a `ANALYZING` enquanto o job roda e volta ao estado resultante.
4. **Estados vazios honestos:** sem transações → "Ainda não há movimentações neste mês. Registre a primeira ou diga ao NORBIUS: *gastei 50 no mercado*." Sem histórico suficiente → projeção oculta com explicação "preciso de pelo menos 14 dias de registros".

### 8.3 NORBIUS CORE — estados reais

Estado calculado no servidor (`packages/intelligence/core-state.ts`) por prioridade; cada estado expõe as **razões** (clicáveis) que o originaram:

| Prioridade | Estado | Condição real |
|---|---|---|
| 1 | `ANALYZING` | Há job de inteligência em execução para o usuário ou tool da IA em execução. |
| 2 | `ATTENTION` | Existe insight aberto `critical`/`attention`: saldo projetado negativo no horizonte, conta vencendo ≤ 3 dias sem saldo previsto, fatura vencida, cartão > 90% do limite, gasto anômalo. |
| 3 | `OPTIMIZING` | Sem alertas e há oportunidades abertas (`opportunity`): assinatura recorrente detectada não categorizada, meta fora do ritmo com margem para aporte, categoria acima da média. |
| 4 | `STABLE` | Histórico suficiente, sem alertas nem oportunidades abertas, projeção do mês ≥ 0. |
| 5 | `ACTIVE` | Sistema operante, mas dados insuficientes para avaliar (ex.: < 14 dias de histórico ou onboarding recém-concluído). |

Microinterações discretas: pulsação lenta em `ACTIVE/STABLE`, anel girando em `ANALYZING`, brilho vermelho contido em `ATTENTION`. Respeita `prefers-reduced-motion`. Nunca anima "pensando" sem um processo real em curso.

---

## 9. Arquitetura do NORBIUS AI

### 9.1 Pipeline de uma mensagem

```
POST /v1/ai/conversations/:id/messages  (SSE streaming)
 │
 ├─ 1. Guardas: auth · rate limit (ex.: 20 msg/min) · cota do plano (ai_usage) · tamanho máx. da mensagem
 ├─ 2. Persistir mensagem do usuário (cifrada)
 ├─ 3. Context builder (§11):
 │      system prompt versionado (identidade, regras, data/fuso atual, formato pt-BR)
 │      + snapshot financeiro compacto (contas, saldo disponível, mês corrente, metas) — gerado por código
 │      + memórias do usuário relevantes
 │      + resumo da conversa + últimas N mensagens
 ├─ 4. Chamada ao Claude com tools permitidas pelo plano (tool_choice auto, streaming)
 ├─ 5. Loop de tool use (máx. 6 iterações):
 │      para cada tool_use:
 │        · valida input com Zod (rejeita e devolve erro ao modelo se inválido)
 │        · injeta user_id da sessão (o modelo NUNCA fornece user_id)
 │        · classifica risco → executa | cria ai_pending_action
 │        · executa via service de domínio dentro da transação RLS
 │        · devolve resultado estruturado (com kind actual/estimate)
 ├─ 6. Streaming da resposta + "cartões" estruturados (transação criada, confirmação pendente, gráfico)
 ├─ 7. Pós-processamento: validador de números (§9.4), registro de tokens/custo/latência, audit_logs
 └─ 8. Assíncrono: atualizar resumo da conversa, extrair memórias candidatas, recompute-intelligence se houve escrita
```

### 9.2 Detecção de intenção

O *tool calling* nativo do Claude é o mecanismo principal de intenção — mais robusto para pt-BR coloquial ("torrei 80 conto no ifood ontem") do que um classificador separado. Complementos:

- **Roteador leve (Haiku)** opcional para mensagens ambíguas ou fora de escopo, escolhendo o subconjunto de tools e o modelo — reduz custo em conversas triviais.
- **Resolução de entidades determinística:** "mercado" → categoria Alimentação via dicionário de comerciantes/palavras-chave + histórico do usuário; "ontem" → data no fuso do usuário; "no nubank" → conta/cartão por *fuzzy match* no nome. Ambiguidade real → a tool retorna `needs_clarification` com as opções e o NORBIUS pergunta **só o que falta**.

### 9.3 Política de ações (autorização)

| Nível | Exemplos | Comportamento |
|---|---|---|
| **Leitura** | saldo, gastos por categoria, metas, próximas contas | Executa direto. |
| **Criação explícita** | "Gastei 50 no mercado", "Recebi 3200", "Crie uma meta de 5000" com todos os campos claros | Executa, mostra cartão com o que foi registrado e botão **Desfazer** (soft delete, janela de 10 min). |
| **Criação inferida** | valor, conta ou data inferidos com baixa confiança | Cria `ai_pending_action` → cartão **Confirmar / Ajustar / Cancelar**. |
| **Alteração / exclusão** | "muda aquele gasto para 60", "apaga o Uber de ontem" | **Sempre** confirmação explícita, mostrando antes → depois. |
| **Bloqueado para a IA** | excluir conta, alterar assinatura, exportar/excluir dados, alterar senha/e-mail | Não existe tool; o NORBIUS direciona para a tela correta. |

A confirmação é um clique na UI (`POST /v1/ai/pending-actions/:id/confirm`), não um "sim" interpretado pelo LLM — o servidor executa exatamente o `payload` validado que o usuário viu.

### 9.4 Salvaguardas contra alucinação

1. **System prompt**: nunca afirmar valores que não vieram de tools/snapshot; diferenciar "registrado" de "estimado"; dizer quando faltam dados; não prometer resultados; não recomendar produto financeiro específico; lembrar que não é assessoria regulada (CVM/Bacen) quando o tema for investimento.
2. **Tools retornam `kind` e `as_of`** em cada número; o prompt exige rótulo "estimativa" quando `kind=estimate`.
3. **Validador pós-resposta:** extrai valores monetários (regex pt-BR) da resposta e confere se cada um aparece nos resultados de tools/snapshot do turno (com tolerância a somas triviais). Divergência → log + métrica `ai.unverified_number`; em modo estrito, regenera uma vez.
4. **Evals contínuos** (§19) com casos de armadilha ("quanto gastei em 2019?" sem dados → deve dizer que não há registros).
5. **Injeção de prompt:** descrições de transações e textos de usuários são tratados como dados (delimitados); tools são sempre escopadas ao usuário, então mesmo um prompt malicioso não alcança dados de terceiros.

### 9.5 Modelos e custo

| Uso | Modelo (configurável) |
|---|---|
| Chat principal com tools | `claude-sonnet-5` |
| Roteamento, parsing de onboarding, resumo de conversa, redação de insights | `claude-haiku-4-5-20251001` |

*Prompt caching* no system prompt + definições de tools (grande parte fixa) reduz custo e latência. Custo por mensagem registrado em `ai_usage`; alerta se custo médio/usuário ultrapassar o limite do plano.

---

## 10. Tools da IA

Todas definidas em `apps/api/src/modules/ai/tools/*`, com schema Zod → JSON Schema, e implementadas chamando services de domínio. `user_id` nunca aparece no schema.

| Tool | Tipo | Entrada principal | Saída | Plano |
|---|---|---|---|---|
| `get_financial_overview` | leitura | `period?` | saldo disponível, receitas, despesas, sobra estimada | Free |
| `get_account_balances` | leitura | `account_ref?` | saldos por conta | Free |
| `search_transactions` | leitura | `query?, period, category?, account?, type?, min/max, limit` | lista + total | Free |
| `get_spending_by_category` | leitura | `period, category?` | totais e % por categoria | Free |
| `compare_periods` | leitura | `period_a, period_b, dimension (category/total)` | deltas absolutos e % | Free (mensal) / Pro (livre) |
| `list_upcoming_bills` | leitura | `days_ahead (≤ 90)` | recorrências, faturas, agendadas | Free |
| `get_credit_cards` | leitura | `card_ref?` | limite, disponível, fatura atual, vencimento | Free |
| `get_card_invoice` | leitura | `card_ref, month?` | itens e total da fatura | Free |
| `get_goals` | leitura | `goal_ref?` | progresso, ritmo necessário | Free |
| `create_transaction` | escrita | `type, amount, description, category?, account?, date?, payment_method?` | transação criada ou `needs_clarification` | Free |
| `create_card_purchase` | escrita | `card_ref, amount, description, installments?, category?, date?` | compra + parcelas | Free |
| `create_transfer` | escrita (confirma) | `from, to, amount, date?` | pending action | Free |
| `update_transaction` | escrita (confirma) | `transaction_id, changes` | pending action | Free |
| `delete_transaction` | escrita (confirma) | `transaction_id` | pending action | Free |
| `create_goal` | escrita | `name, target_amount, target_date?` | meta criada | Free (limite de metas) |
| `add_goal_contribution` | escrita | `goal_ref, amount, date?` | aporte | Free |
| `create_recurring` | escrita (confirma) | `type, amount, description, frequency, day` | pending action | Free |
| `get_safe_to_spend` | leitura/estimativa | `window: week/month` | valor + premissas | Pro |
| `get_balance_projection` | leitura/estimativa | `horizon_days ≤ 90` | p10/p50/p90 + premissas + confiança | Pro |
| `get_insights` | leitura | `status?, severity?` | insights com evidência | Free (básicos) / Pro (avançados) |
| `detect_patterns` | leitura | `period` | recorrências e padrões detectados | Pro |
| `generate_report` | ação assíncrona | `kind, period, format` | link quando pronto (notificação) | Pro |
| `remember` / `forget` | memória | `content` / `memory_id` | memória salva/removida (visível ao usuário) | Free |

Mapeamento dos exemplos do produto:

| Frase | Tool(s) |
|---|---|
| "Gastei 50 reais no mercado." | `create_transaction(expense, 5000, "Mercado", categoria→Alimentação)` |
| "Recebi 3200 reais." | `create_transaction(income, 320000, …)` — pergunta a conta só se houver mais de uma e nenhuma padrão |
| "Quanto posso gastar essa semana?" | `get_safe_to_spend(week)` → resposta rotulada como estimativa |
| "Quanto gastei com alimentação?" | `get_spending_by_category(mês atual, Alimentação)` |
| "Quanto vai sobrar no final do mês?" | `get_balance_projection` → "estimativa: entre R$ X e R$ Y, mais provável R$ Z" |
| "Estou gastando mais que no mês passado?" | `compare_periods` (mesmo dia do mês, *like-for-like*) |
| "Quais são minhas próximas contas?" | `list_upcoming_bills(30)` |
| "Crie uma meta de 5000 reais." | `create_goal` — pergunta nome se não for dito |
| "Como está minha situação financeira?" | `get_financial_overview` + `get_insights` |

---

## 11. Sistema de memória

| Camada | O que guarda | Onde | Ciclo de vida |
|---|---|---|---|
| **Curto prazo** | últimas ~20 mensagens da conversa | `ai_messages` | janela deslizante |
| **Resumo de conversa** | resumo rolante das mensagens fora da janela | `ai_conversations.summary` | atualizado por job (Haiku) a cada ~10 mensagens |
| **Longo prazo (memórias)** | preferências e fatos declarados: "prefere respostas curtas", "recebe dia 5", "está juntando para casamento" | `ai_memories` | criadas via tool `remember` ou extração pós-conversa; **visíveis, editáveis e apagáveis** em Configurações → Memórias do NORBIUS |
| **Estado financeiro** | saldos, transações, metas | tabelas de domínio | **não é memória**: sempre consultado ao vivo via tools/snapshot, nunca "lembrado" |

Regras:

- Memória nunca substitui dado: se a memória diz "recebe dia 5" mas há recorrência cadastrada dia 10, prevalece o dado e o NORBIUS pode perguntar qual é o correto.
- Memórias `inferred` são mostradas ao usuário para confirmação antes de serem usadas em respostas.
- Não armazenar em memória dados sensíveis desnecessários (saúde, religião, etc. — LGPD art. 11); filtro no extrator.
- Seleção de memórias no contexto: todas as `preference` + `fact`/`context` mais recentes/relevantes (limite de tokens). Busca vetorial (pgvector) fica para quando o volume justificar — não na v1.

---

## 12. Sistema de projeções

Engine determinística em `packages/intelligence/projection` (pura, versionada por `method_version`, 100% testável).

### 12.1 Entradas

| Entrada | Fonte | Tipo |
|---|---|---|
| Saldo atual | `account_balances` (contas com `include_in_available_balance`) | real |
| Receitas futuras | `recurring_transactions` de receita + transações `scheduled` | real se confirmadas; estimativa se `amount_is_estimate` |
| Despesas recorrentes | `recurring_transactions` de despesa | idem |
| Contas futuras | faturas de cartão (fechadas e projeção da aberta), boletos agendados | real / estimativa |
| Histórico de gastos | gastos variáveis (não recorrentes) dos últimos 90 dias | base estatística |

### 12.2 Método (v1)

1. **Linha base determinística:** saldo atual + eventos conhecidos datados, dia a dia até o horizonte (fim do mês ou até 90 dias).
2. **Gasto variável estimado:** perfil diário por dia da semana a partir da mediana dos últimos 90 dias, excluindo outliers (MAD) e transações já cobertas por recorrências.
3. **Incerteza:** *bootstrap* de dias históricos (1.000 amostras) → percentis **p10 / p50 / p90** por dia.
4. **Confiança:** `low` (< 30 dias de histórico ou renda irregular), `medium` (30–89), `high` (≥ 90 dias e renda regular).
5. **Saída** inclui a lista de **premissas** ("considerei R$ 1.800 de aluguel dia 05, fatura Nubank estimada em R$ 940, gasto variável médio de R$ 62/dia").

### 12.3 "Quanto posso gastar?" (*safe-to-spend*)

```
disponível_até_próxima_receita = saldo_p50_no_dia_anterior_à_próxima_receita
                                − compromissos_fixos_até_lá
                                − aportes_planejados_em_metas
                                − reserva_de_segurança (configurável, padrão 10% da renda ou R$ 0 se não informada)
semana = max(0, disponível / dias_restantes) × 7
```

Sempre apresentado como **estimativa**, com as premissas e o nível de confiança. Com histórico insuficiente, o NORBIUS diz isso em vez de chutar.

Execução: sob demanda (cache em `projection_snapshots` por `inputs_hash`) e recalculada pelo job após escritas relevantes.

---

## 13. Sistema de insights

Detectores determinísticos em `packages/intelligence/detectors`, executados pelo worker (após escritas com debounce, diariamente às 06:00 no fuso do usuário e no fechamento do mês). A IA **não descobre** insights; ela apenas pode reescrever o texto a partir de `evidence` (Pro) — o texto base é sempre gerado por template.

| Detector | Regra (v1) | Severidade |
|---|---|---|
| `category_increase` | gasto da categoria até o dia D do mês > 125% do mesmo intervalo no mês anterior **e** diferença ≥ R$ 50 | attention/opportunity |
| `anomaly` | transação com *robust z-score* (mediana/MAD da categoria, 90 dias) > 3,5 e ≥ R$ 100 | attention |
| `recurring_detected` | ≥ 3 ocorrências da mesma descrição normalizada, valor ±10%, intervalo 28–33 dias, sem recorrência cadastrada → sugere cadastrar | opportunity |
| `subscription_creep` | total da categoria Assinaturas cresceu ≥ 20% em 3 meses | opportunity |
| `bill_due` | recorrência/fatura vencendo em ≤ 3 dias | attention (critical se saldo projetado < valor) |
| `card_limit` | uso do limite ≥ 80% (attention) / ≥ 95% (critical) | attention/critical |
| `projected_negative` | p50 do saldo projetado < 0 no horizonte | critical |
| `goal_off_track` | aporte necessário/mês para cumprir prazo > 1,5× média de aportes | opportunity |
| `goal_reached` | `current ≥ target` | info |
| `spending_pace` | ritmo de gasto do mês projeta total > renda média declarada | attention |
| `monthly_summary` | fechamento do mês | info |

Controles: `fingerprint` único evita duplicatas; *cooldown* por tipo; insights expiram quando a condição deixa de existir (`resolved`); usuário pode dispensar. Plano Free recebe `bill_due`, `card_limit`, `goal_reached`, `monthly_summary`; Pro recebe todos.

Notificações derivam de insights (`notifications.dedup_key = insight.fingerprint`), respeitando `notification_preferences` e horário silencioso (22h–8h).

---

## 14. Sistema de assinatura

### 14.1 Planos (valores e limites são propostas — ver §25)

| Recurso | Free | Pro |
|---|---|---|
| Dashboard, contas, transações, categorias, cartões | ✓ | ✓ |
| Metas | até 3 | ilimitadas |
| Mensagens com o NORBIUS | 30/mês | 1.000/mês (uso justo) |
| Insights | básicos | avançados |
| Projeções e *safe-to-spend* | — | ✓ |
| Relatórios PDF/CSV | exportação CSV de transações | relatórios completos |
| Memórias do NORBIUS | ✓ | ✓ |

Trial opcional: 7 dias de Pro sem cartão, ativado uma vez por usuário.

### 14.2 Fluxos

- **Upgrade:** `POST /v1/billing/checkout` → Stripe Checkout (BRL) → webhook `checkout.session.completed` / `customer.subscription.updated` → `subscriptions` atualizada → entitlements aplicados imediatamente.
- **Gerenciar / downgrade / cancelamento:** Stripe Billing Portal. Cancelamento = `cancel_at_period_end`; o Pro vale até o fim do período pago. No downgrade **nenhum dado é apagado** — recursos Pro ficam bloqueados (metas excedentes ficam somente leitura).
- **Falha de pagamento:** `past_due` → aviso in-app + e-mail, período de carência de 7 dias, depois volta ao Free.
- **Histórico de pagamentos:** tabela `payments` alimentada por `invoice.paid` / `invoice.payment_failed`.

### 14.3 Implementação

- `BillingProvider` (interface): `createCheckout`, `createPortalSession`, `parseWebhook`, `cancel`. Implementação `StripeBillingProvider` na v1.
- Webhooks: assinatura verificada, idempotência por `billing_events.id`, processamento em fila, reconciliação diária (job compara com o provedor).
- **Entitlements** centralizados: `entitlements.can(user, 'projections')` e `entitlements.limit(user, 'ai_messages_per_month')` — usados pela API, pela IA (tools disponíveis) e pela UI (paywall). Nunca checar plano espalhado pelo código.

---

## 15. Arquitetura do painel admin

- **App separado** (`apps/admin`, domínio `admin.norbius.com.br`), **identidade separada** (`admin_users`, nunca um usuário comum com flag), MFA obrigatório (TOTP ou WebAuthn), sessões de 8 h, opção de allowlist de IP / acesso via VPN/Cloudflare Access.
- **RBAC:** `support` (usuários, tickets), `billing` (assinaturas), `analyst` (métricas agregadas), `superadmin` (gestão de admins).
- **Isolamento de dados financeiros no banco:** a API admin conecta com um **papel de banco distinto** (`norbius_admin`) que só tem `GRANT` em: `users` (colunas não sensíveis), `profiles` (parcial), `subscriptions`, `payments`, `audit_logs`, `support_tickets` e **views agregadas** (`admin_metrics_*`). **Sem `GRANT` em `transactions`, `accounts`, `credit_card_*`, `goals`, `ai_messages`, `ai_memories`.** O bloqueio é estrutural, não uma convenção.
- **Acesso excepcional:** só via `support_access_grants` criado **pelo próprio usuário** ("permitir que o suporte veja minhas transações por 24 h para resolver o chamado #123"), escopado, com expiração, revogável e com cada leitura registrada em `audit_logs`. O usuário é notificado.
- **Métricas do dashboard admin** (views materializadas atualizadas por job): total de usuários, ativos (DAU/WAU/MAU por `last_seen_at`), novos, assinaturas por status, MRR, conversão Free→Pro, churn/cancelamentos, uso da IA (mensagens, tokens, custo), taxa de erros (Sentry API).
- **Gestão de usuários:** listar, pesquisar (e-mail/nome), filtrar (plano, status, data), ver plano/status/datas de acesso; ações sensíveis (suspender, conceder trial, cancelar assinatura) exigem papel adequado + motivo obrigatório + auditoria.

---

## 16. Segurança

| Requisito | Implementação |
|---|---|
| Autenticação segura | Better Auth, Argon2id, sessões opacas revogáveis, 2FA, checagem de senhas vazadas |
| Autorização | sessão → `user_id` do servidor; RBAC para admin; entitlements para planos |
| Isolamento por usuário | RLS em todas as tabelas do usuário + FKs compostas `(user_id, id)` + repositórios sem parâmetro `user_id` vindo do cliente. O papel de banco da aplicação **não** é owner das tabelas nem tem `BYPASSRLS` |
| Proteção contra acesso cruzado (IDOR) | IDs UUID + RLS + suíte de testes automatizada que tenta acessar cada recurso com outro usuário (§19) |
| Proteção de rotas | middleware web + validação na API (barreira real) |
| Validação de inputs | Zod em toda borda (HTTP, tools da IA, webhooks, jobs); limites de tamanho; valores máximos plausíveis |
| Rate limiting | Redis, por usuário e por IP: auth, IA (por minuto e cota mensal), escrita, exportações |
| Secrets somente no backend | nenhuma chave em `NEXT_PUBLIC_*` exceto chaves públicas; secrets em gerenciador (Doppler/1Password/Secrets do provedor); `gitleaks` no CI |
| Criptografia | TLS 1.2+ em tudo; criptografia em repouso do provedor; **criptografia em nível de campo** (AES-256-GCM, envelope com chave via KMS, rotação) para `ai_messages.content`, `ai_conversations.summary`, `transactions.notes`, segredos 2FA/OAuth e credenciais de integrações |
| Headers | `helmet`: CSP estrita com nonce, HSTS, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy` |
| Logs de segurança | login ok/falha, reset de senha, 2FA, alteração de e-mail, sessões encerradas, ações admin, confirmações de ações da IA → `audit_logs` (append-only) |
| Auditoria | `audit_logs` com `request_id` correlacionado aos traces; retenção de 1 ano |
| Backups | PITR de 7–14 dias + snapshot diário cifrado em outra região/conta; **teste de restore mensal** documentado |
| Recuperação de conta | reset por e-mail, códigos de backup do 2FA, fluxo de suporte com verificação |
| Exclusão de dados | ver §17 |
| Dependências | Dependabot/Renovate, `pnpm audit`, CodeQL, lockfile obrigatório |
| IA | tools escopadas, sem acesso a dados de outros usuários por construção; limites de iteração; nenhuma tool destrutiva de alto impacto |

---

## 17. Privacidade (LGPD)

- **Bases legais:** execução de contrato (funcionalidades principais), consentimento (e-mails de marketing, analytics não essencial), legítimo interesse (segurança/antifraude) — documentadas no Registro de Operações de Tratamento (ROPA).
- **Minimização:** não pedimos CPF, endereço nem número de cartão (apenas os 4 últimos dígitos, opcional). Renda é opcional. Analytics sem valores financeiros e sem descrições de transações.
- **IA e transferência internacional:** o processamento pelo provedor de LLM ocorre fora do Brasil → informado na Política de Privacidade (LGPD art. 33), com DPA assinado com o provedor e confirmação contratual de que dados via API não são usados para treinamento. Enviar ao modelo apenas o necessário para a pergunta (snapshot compacto, não o histórico inteiro).
- **Direitos do titular** em Configurações → Privacidade:
  - **Exportar meus dados** (JSON + CSV, job assíncrono, link assinado 24 h).
  - **Excluir minha conta:** confirmação com senha/2FA → `pending_deletion` (sessões revogadas, assinatura cancelada) → purga física após 30 dias (janela de arrependimento) → backups expiram pelo ciclo de retenção → registro mínimo em `audit_logs` sem PII.
  - **Memórias da IA** e **histórico de conversas** visíveis e apagáveis individualmente.
  - Gestão de consentimentos.
- **Retenção:** conversas da IA 12 meses (configurável pelo usuário), logs de aplicação 30 dias, `audit_logs` 1 ano, dados financeiros enquanto a conta existir.
- **Documentos:** Política de Privacidade, Termos de Uso, canal do Encarregado (DPO), plano de resposta a incidentes (comunicação à ANPD e titulares).
- **Aviso regulatório:** o NORBIUS não é instituição financeira nem consultor de valores mobiliários; conteúdo é informativo.

---

## 18. Observabilidade

| Sinal | Ferramenta | Detalhe |
|---|---|---|
| Logs | pino (JSON) → provedor de logs (Axiom/Better Stack/Datadog) | `request_id`, `user_id` pseudonimizado (hash), **redaction** automática de e-mail, valores, descrições, tokens |
| Erros | Sentry (web, api, worker, admin) | *source maps*, release por commit, *scrubbing* de PII |
| Traces | OpenTelemetry → Sentry/Tempo | spans para HTTP, SQL, Redis, filas e **cada chamada ao LLM e cada tool** |
| Métricas | OTel metrics | latência p50/p95 por rota; profundidade/atraso das filas; IA: tempo até o primeiro token, tokens, custo, taxa de erro de tools, `ai.unverified_number`, taxa de confirmação/desfazer |
| Uptime | Better Stack / Checkly | `/health` (liveness) e `/ready` (DB + Redis), fluxo sintético de login |
| Produto | PostHog | eventos de §Analytics, sem PII financeira, opt-out respeitado |
| Alertas | Slack/e-mail | taxa de erro 5xx > 1%, p95 > 1,5 s, fila atrasada > 5 min, falha de webhook de billing, custo de IA diário acima do orçamento, falha de backup |

SLOs iniciais: disponibilidade 99,5%; p95 das APIs de leitura < 400 ms; primeiro token da IA < 2,5 s p95.

---

## 19. Plano de testes

| Nível | Ferramenta | Escopo crítico |
|---|---|---|
| Unitário | Vitest | `packages/domain` (centavos, arredondamento de parcelas, alocação em fatura com fechamento/dia 31/fevereiro, saldos), `packages/intelligence` (cada detector com casos positivos/negativos, projeção com seeds fixas, estado do CORE), parser de valores pt-BR ("R$ 1.234,56", "50 conto", "3,2 mil") |
| Integração | Vitest + Testcontainers (Postgres e Redis reais) | repositórios, migrações, triggers, **políticas RLS**, webhooks do Stripe (fixtures assinadas), jobs |
| **Isolamento** | suíte dedicada | para **cada** rota/tool: usuário B tentando ler/alterar recurso do usuário A → deve retornar 404; conexão com `app.user_id` de B → 0 linhas de A. Falha nessa suíte bloqueia deploy |
| Contrato | OpenAPI gerado + testes | web/admin consomem tipos de `packages/contracts`; quebra de contrato falha o CI |
| E2E | Playwright | cadastro → verificação → onboarding → registrar gasto pela UI e pelo chat → dashboard reflete → desfazer; upgrade (Stripe test mode); exportar e excluir conta; login admin com MFA sem acesso a transações |
| IA (evals) | runner próprio em `evals/` | ~300 frases pt-BR rotuladas → tool e argumentos esperados; casos de ambiguidade (deve perguntar), de ausência de dados (não pode inventar), de injeção de prompt, de pedido de recomendação de produto; métricas: acurácia de tool, acurácia de argumentos, taxa de alucinação numérica. Roda no CI em mudanças de prompt/tools/modelo com limiar mínimo |
| Segurança | ZAP baseline, `gitleaks`, CodeQL, testes de rate limit | + revisão manual na Fase 8 |
| Carga | k6 | dashboard e chat em 200 usuários simultâneos |
| Acessibilidade | axe (Playwright) | contraste do tema escuro (vermelho sobre preto verificado para AA), navegação por teclado |

---

## 20. Roadmap por fases

Cada fase termina com: testes verdes, documentação atualizada (ADR quando houver decisão relevante) e demonstração funcional — **sem botões sem função e sem dados falsos**.

| Fase | Nome | Entregas | Critério de pronto |
|---|---|---|---|
| **0** | Blueprint | Este documento | Aprovação do dono do produto |
| **1** | Foundation | Monorepo, CI, Postgres + Drizzle + RLS base, Better Auth (cadastro, login, Google, verificação, reset, logout, sessões), design system NORBIUS (tokens, tipografia, componentes base, NORBIUS CORE estático em estado `ACTIVE`), layout do app, rotas protegidas, landing/preços/FAQ/privacidade/termos (conteúdo real), observabilidade base | Usuário se cadastra, verifica e-mail, entra e vê o layout protegido; suíte de isolamento rodando no CI |
| **2** | Financial Core | Contas, categorias (sistema + custom), transações (CRUD, busca, filtro, ordenação), transferências, recorrências, cartões (compras, parcelas, faturas, pagamento), metas e aportes, onboarding conversacional completo, dashboard v1 com dados reais, exportação CSV | Fluxo completo sem IA; saldos e faturas batem com testes de domínio |
| **3** | NORBIUS AI | Chat com streaming, orquestrador, tools de leitura e escrita, política de confirmação/desfazer, context builder, memória (curto prazo + resumo + memórias visíveis), cota por plano (contagem), evals no CI | Todos os exemplos do produto funcionam; taxa de alucinação numérica ≈ 0 nos evals |
| **4** | Financial Intelligence | Detectores de insights, anomalias, recorrências, projeção p10/p50/p90, safe-to-spend, alertas e notificações (in-app + e-mail), estado real do CORE | Insights com evidência auditável; projeções rotuladas como estimativa |
| **5** | Premium Experience | Dashboard final, NORBIUS CORE animado com estados reais, microinterações, responsividade e otimização mobile (PWA), relatórios PDF | Lighthouse ≥ 90 mobile; revisão de UX |
| **6** | SaaS | Preços, Stripe Checkout/Portal, webhooks, entitlements, limites por plano, trial, histórico de pagamentos | Upgrade/downgrade/cancelamento testados E2E |
| **7** | Admin | App admin, auth separada + MFA, métricas, usuários, assinaturas, logs, acesso excepcional autorizado pelo usuário | Papel admin comprovadamente sem acesso a dados financeiros |
| **8** | Production | Revisão de segurança, pentest leve, performance, backups com teste de restore, alertas, runbooks, fluxo LGPD de exportação/exclusão, deploy de produção | Checklist de lançamento completo |
| **9** | Future | Open Finance, sincronização automática, importação OFX/CSV, IA avançada, agente proativo, app mobile | — |

> **Observação:** metas e cartões aparecem na Fase 2 (junto com o Financial Core) porque o onboarding (Fase 2) já os coleta — evita construir telas de onboarding que gravam em entidades inexistentes.

---

## 21. Dependências

**Runtime (principais)**

| Pacote | Uso |
|---|---|
| `next`, `react`, `react-dom` | frontend |
| `tailwindcss`, `@radix-ui/*`, `class-variance-authority`, `lucide-react` | UI |
| `motion` | microinterações |
| `@visx/*` (ou `recharts`) | gráficos |
| `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers` | dados/forms |
| `zod` | validação compartilhada |
| `fastify`, `@fastify/helmet`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/cors`, `fastify-type-provider-zod`, `@fastify/swagger` | API |
| `drizzle-orm`, `postgres` (driver) | banco |
| `better-auth` | autenticação |
| `bullmq`, `ioredis` | filas e cache |
| `@anthropic-ai/sdk` | IA |
| `stripe` | billing |
| `resend`, `@react-email/components` | e-mail |
| `@react-pdf/renderer` | PDFs |
| `date-fns`, `date-fns-tz` | datas/fuso |
| `pino`, `@sentry/node`, `@sentry/nextjs`, `@opentelemetry/*` | observabilidade |
| `posthog-js`, `posthog-node` | analytics |

**Dev**

`typescript`, `turbo`, `drizzle-kit`, `vitest`, `@testcontainers/postgresql`, `@testcontainers/redis`, `@playwright/test`, `@axe-core/playwright`, `eslint` (+ `eslint-plugin-boundaries`), `prettier`, `k6` (CI), `gitleaks`, `tsx`.

---

## 22. Variáveis de ambiente

Nunca versionadas. `.env.example` por app com descrições. Validadas no boot com Zod (app não sobe se faltar variável).

```bash
# ── Comum ──────────────────────────────────────────────
NODE_ENV=production
APP_ENV=production                    # development | staging | production
APP_URL=https://app.norbius.com.br
API_URL=https://api.internal.norbius  # usado pelo proxy do web (server-side)
ADMIN_URL=https://admin.norbius.com.br

# ── Banco / cache ──────────────────────────────────────
DATABASE_URL=postgres://norbius_app:...@.../norbius        # papel da aplicação (sem BYPASSRLS)
DATABASE_ADMIN_URL=postgres://norbius_admin:...@.../norbius # papel restrito do painel admin
DATABASE_MIGRATION_URL=postgres://norbius_owner:...        # só no job de migração
REDIS_URL=rediss://...

# ── Autenticação ───────────────────────────────────────
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://app.norbius.com.br
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
TURNSTILE_SITE_KEY=...                # público
TURNSTILE_SECRET_KEY=...
ADMIN_AUTH_SECRET=...

# ── Criptografia de campo ──────────────────────────────
FIELD_ENCRYPTION_KEY_ID=...           # referência da chave no KMS
KMS_PROVIDER=aws                      # aws | gcp | local (dev)
AWS_REGION=sa-east-1

# ── IA ─────────────────────────────────────────────────
ANTHROPIC_API_KEY=...
AI_MODEL_CHAT=claude-sonnet-5
AI_MODEL_FAST=claude-haiku-4-5-20251001
AI_MAX_TOOL_ITERATIONS=6
AI_DAILY_BUDGET_USD=...

# ── Billing ────────────────────────────────────────────
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...

# ── E-mail ─────────────────────────────────────────────
RESEND_API_KEY=...
EMAIL_FROM="NORBIUS <ola@norbius.com.br>"

# ── Storage (relatórios, exportações) ──────────────────
S3_BUCKET=norbius-private
S3_REGION=sa-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# ── Observabilidade / analytics ────────────────────────
SENTRY_DSN=...
NEXT_PUBLIC_SENTRY_DSN=...
OTEL_EXPORTER_OTLP_ENDPOINT=...
LOG_LEVEL=info
NEXT_PUBLIC_POSTHOG_KEY=...
POSTHOG_HOST=https://eu.i.posthog.com

# ── Futuro Open Finance (vazias na v1) ─────────────────
OPEN_FINANCE_PROVIDER=
OPEN_FINANCE_CLIENT_ID=
OPEN_FINANCE_CLIENT_SECRET=
OPEN_FINANCE_WEBHOOK_SECRET=
```

---

## 23. Estratégia de deploy

| Componente | Hospedagem recomendada | Observação |
|---|---|---|
| `apps/web` | Vercel (região `gru1`) | marketing SSG + app; preview por PR |
| `apps/admin` | Vercel (projeto separado) + Cloudflare Access / allowlist | domínio separado |
| `apps/api` | Fly.io / Railway / AWS ECS em São Paulo | container Docker, ≥ 2 instâncias, autoscaling |
| `apps/worker` | mesmo provedor da API | processo separado, escala independente |
| PostgreSQL | Neon / Supabase / RDS em `sa-east-1` | PITR, réplica de leitura quando necessário |
| Redis | Upstash / ElastiCache em `sa-east-1` | TLS |
| Storage | S3 (ou R2) privado | URLs assinadas curtas |

**Ambientes:** `development` (docker-compose local), `preview` (por PR, banco efêmero via branching do Neon), `staging` (espelho de produção com dados sintéticos), `production`.

**Pipeline (GitHub Actions):**

```
PR:    lint → typecheck → unit → integração (Testcontainers) → suíte de isolamento → evals (se tocou IA) → build → preview deploy
main:  tudo acima → migração em staging → E2E em staging → aprovação manual → migração em produção → deploy API/worker (rolling) → deploy web/admin → smoke tests → release no Sentry
```

**Regras:** migrações *expand/contract* (compatíveis com a versão anterior do código), nunca destrutivas no mesmo deploy; *feature flags* para lançamentos graduais; rollback = redeploy da imagem anterior (migrações compatíveis permitem isso); backups verificados antes de migrações de risco.

---

## 24. Futura integração Open Finance

**Não implementado na v1.** O que fica pronto desde a Fase 1–2 para evitar reconstrução:

1. **Esquema:** colunas `source`, `external_provider`, `external_id` em `accounts`, `transactions`, `credit_card_purchases`; tabelas `financial_institutions`, `external_connections`, `external_accounts`, `external_raw_transactions` (§4.10) criadas vazias ou em migração dedicada da Fase 9 — a decisão é trivial porque nada no núcleo depende delas.
2. **Interface de provedor** em `apps/api/src/modules/integrations`:

   ```ts
   interface OpenFinanceProvider {
     createConnectToken(userId: string): Promise<{ token: string }>;
     listAccounts(connectionId: string): Promise<ExternalAccount[]>;
     fetchTransactions(connectionId: string, since: Date): AsyncIterable<ExternalTransaction>;
     parseWebhook(req: RawRequest): ProviderEvent;
     revoke(connectionId: string): Promise<void>;
   }
   ```

   Implementações futuras via agregadores autorizados (ex.: Pluggy, Belvo) — o NORBIUS não precisa ser participante direto do Open Finance Brasil na primeira integração.

3. **Pipeline (reaproveita o núcleo):**

   ```
   Instituição financeira → Provedor Open Finance → webhook/sync (worker)
     → external_raw_transactions (payload bruto, idempotente)
     → Normalização (sinal, datas, descrição limpa, conta mapeada)
     → Deduplicação (external_id + heurística contra lançamentos manuais: mesmo valor ± 2 dias)
     → Categorização (MESMO serviço usado no chat/UI: regras + histórico do usuário + LLM de fallback)
     → TransactionService.create(source='open_finance')
     → recompute-intelligence → Dashboard / CORE
   ```

4. **Conciliação com lançamentos manuais:** quando um lançamento sincronizado casa com um manual, o NORBIUS propõe mesclar (nunca apaga sozinho).
5. **Consentimento:** tela própria com escopo, prazo (`consent_expires_at`) e revogação; registro em `consents`.
6. **Caminho intermediário (opcional, pode vir antes da Fase 9):** importação de extrato OFX/CSV usando exatamente o mesmo pipeline com `source='import'` — valida normalização, deduplicação e categorização antes do Open Finance.

---

## 25. Decisões pendentes para o dono do produto

Estas decisões não bloqueiam a Fase 1, mas precisam de resposta até a fase indicada:

| # | Decisão | Proposta | Até |
|---|---|---|---|
| 1 | Onde o código do NORBIUS vai viver | **Repositório dedicado** (este repositório é um fork do Claude Code e não é adequado como casa do produto) | Fase 1 |
| 2 | Provedores de infraestrutura (API/worker, Postgres) | Fly.io ou Railway + Neon em São Paulo (simples) — ou AWS se já houver conta/créditos | Fase 1 |
| 3 | Domínio | `norbius.com.br` (app, admin, api como subdomínios) | Fase 1 |
| 4 | Preço do Pro e limites do Free | ex.: R$ 19,90/mês ou R$ 199/ano; Free com 30 mensagens/mês | Fase 6 |
| 5 | Pix / boleto além de cartão | Stripe (cartão) na v1; Asaas/Pagar.me para Pix Automático depois | Fase 6 |
| 6 | Trial | 7 dias de Pro sem cartão | Fase 6 |
| 7 | Tipografia e logotipo | proposta na Fase 1 (ex.: sans geométrica + mono para números) | Fase 1 |

---

**Próximo passo:** aguardando autorização para iniciar a **FASE 1 — Foundation**.
