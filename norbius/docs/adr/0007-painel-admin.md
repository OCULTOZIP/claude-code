# ADR 0007 — Painel admin (Fase 7)

Data: 2026-09-26 · Status: aceita

## Critério da fase

**O papel admin é comprovadamente sem acesso a dados financeiros.** A prova é estrutural e automatizada (`packages/db/test/admin-isolation.test.ts`): conectado como `norbius_admin`, o banco recusa (`permission denied`) a leitura de 25 tabelas — transações, contas, categorias, cartões, faturas, compras, parcelas, recorrências, metas, aportes, insights, projeções, estados do CORE, notificações e preferências, conversas/mensagens/memórias/ações da IA, perfis (renda), usuários, sessões, credenciais, verificações e o log de auditoria bruto — e qualquer escrita direta nelas.

## Decisões

1. **Identidade separada.** `admin_users` (nunca um usuário comum com flag), senha Argon2id e **TOTP obrigatório** (RFC 6238, SHA-1, 6 dígitos, 30 s, ±1 passo, sem reuso do mesmo passo). Segredo TOTP cifrado com AES-256-GCM (`ADMIN_ENCRYPTION_KEY`). Login em duas etapas com desafio assinado (HMAC, 5 min); bloqueio de 15 min após 5 falhas; 10 tentativas/min por IP; comparação em tempo constante para e-mail inexistente.

2. **Sessão própria de 8 h**: cookie `norbius_admin` (HttpOnly, SameSite=Strict, Secure em https), só o SHA-256 do token no banco, revogável; escritas exigem `Origin` = `ADMIN_URL`. WebAuthn e allowlist de IP ficam para a Fase 8 (infra).

3. **Papel de banco distinto (`norbius_admin`)**, criado por `infra/db/setup-local.sh`. GRANTs apenas em: `admin_users`, `admin_sessions`, `subscriptions` e `billing_payments` (leitura, com políticas RLS próprias), `support_access_grants` (leitura), `audit_logs` (só INSERT) e três views:
   - `admin_customers` — cadastro e assinatura (sem renda, sem saldos);
   - `admin_metrics` — contagens agregadas (usuários, ativos por `last_seen_at`/sessões, assinaturas, conversão, cancelamentos, mensagens e tokens da IA);
   - `admin_audit_logs` — log com `metadata` visível só em ações de admins.
   A API usa uma **conexão separada** (`DATABASE_ADMIN_URL`) só no módulo admin; sem ela o módulo não é registrado.

4. **RBAC em duas camadas** (API e banco): `support` (clientes, suspender/reativar, atividade, acesso excepcional), `billing` (clientes, pagamentos, liberar teste), `analyst` (métricas), `superadmin` (tudo + administradores). Ações sensíveis são **funções `SECURITY DEFINER`** que conferem de novo o admin (ativo + papel), exigem motivo (≥ 5 caracteres) e gravam `audit_logs`:
   - `norbius_admin_set_user_status` — suspender encerra todas as sessões (o login já recusa quem não está ativo);
   - `norbius_admin_grant_trial` — 1 a 90 dias, estende sem encurtar.
   Visualizar um cliente registra `admin.user.view`.

5. **Acesso excepcional autorizado pelo usuário.** `support_access_grants` criado **pelo próprio usuário** em Configurações → Suporte (motivo, 24 h ou 72 h, uma ativa por vez, revogável; RLS). O suporte só lê transações via `norbius_support_transactions`, que exige autorização válida (não expirada, não revogada, escopo `transactions:read`), registra `support.transactions.read` e avisa o usuário no app (no máximo um aviso por hora). Somente leitura; transações de conta (compras no cartão ficam fora do escopo v1).

6. **App separado `apps/admin`** (Next.js, porta 3001, futuro `admin.norbius.com.br`): repassa só `/api/admin/*` à API; `noindex`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`. Telas: métricas, clientes (busca/filtros/detalhe/ações), pagamentos, atividade, administradores.

7. **Criação de admins pela linha de comando** (`pnpm --filter @norbius/api admin:create`): senha digitada sem eco, QR code do autenticador no terminal e confirmação do primeiro código antes de gravar. O painel só ativa/desativa admins (superadmin).

## Pendências

- WebAuthn, allowlist de IP / Cloudflare Access e domínio separado (Fase 8).
- Cancelar assinatura pelo painel (exige chamada ao Asaas) e estorno.
- Tickets de suporte (`support_tickets`) e fluxo LGPD de exportação/exclusão (Fase 8).
