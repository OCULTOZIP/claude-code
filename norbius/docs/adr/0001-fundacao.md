# ADR 0001 — Decisões da Fundação (Fase 1)

Data: 2026-09-26 · Status: aceita

## Contexto
A Fase 1 entrega projeto, banco, autenticação, design system, layout e rotas protegidas, conforme `docs/BLUEPRINT.md`.

## Decisões

1. **Next.js 16** (não 15, como citado no blueprint): é a versão estável atual. Mudanças relevantes: `middleware.ts` passou a se chamar `proxy.ts`; APIs de request (`params`, `searchParams`, `cookies()`) são assíncronas.
2. **TypeScript 6.0** (não 7.0): o TS 7 (port nativo) ainda não expõe a API JS usada por Next.js e drizzle-kit.
3. **BFF por rewrites**: o navegador fala só com a origem do app; `/api/*` é repassado à API. Consequência: `API_URL` é **fixado no build** do web (rewrites entram no manifesto). Cada ambiente precisa do seu build.
4. **RLS com papel não-dono**: a aplicação conecta como `norbius_app`, que não é dono das tabelas, então as políticas sempre se aplicam a ela. Migrações rodam como `norbius_owner`. Tabelas de autenticação não têm RLS (acessadas só pela camada de auth); tabelas de domínio têm. Toda nova tabela concede privilégios explicitamente na migração.
5. **Better Auth** com sessões no banco, Argon2id (OWASP: m=19 MiB, t=2, p=1), verificação de e-mail obrigatória antes do login, revogação de sessões ao redefinir senha, rate limit por rota persistido no banco (funciona com várias instâncias).
6. **IP do cliente**: a API repassa ao Better Auth somente o IP resolvido pelo Fastify (`TRUST_PROXY_HOPS`). Sem isso, requisições com vários IPs em `x-forwarded-for` caíam num bucket de rate limit compartilhado — um atacante poderia bloquear o login de todos.
7. **Aceite de termos validado no servidor** (hook do Better Auth) e registrado em `consents` com a versão (`LEGAL_VERSION`).
8. **Endpoints do Better Auth desativados** quando o NORBIUS não os oferece (update-user, delete-user, change-email, tokens de provedor). Exclusão de conta seguirá o fluxo LGPD (Fase 8).
9. **CSP sem nonce** para manter as páginas de marketing estáticas. Nonce/SRI ficam para a revisão de segurança (Fase 8).
10. **E-mail**: Resend em staging/produção (obrigatório pela validação de ambiente). Em dev sem chave, o e-mail vai para o log; nos testes, para memória (integração) ou arquivo (`MAIL_OUTBOX_DIR`, proibido em staging/produção).

## Fora do escopo desta fase
Worker/filas, painel admin, 2FA, Sentry/OpenTelemetry (há logs estruturados com redaction, request id e health/readiness), onboarding e todo o núcleo financeiro.
