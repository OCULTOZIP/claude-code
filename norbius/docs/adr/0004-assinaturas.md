# ADR 0004 — Assinaturas (Fase 6)

Data: 2026-09-26 · Status: aceita

## Decisões do dono do produto

- **Meio de pagamento: Asaas** (Pix, boleto e cartão; mercado brasileiro). Substitui o Stripe previsto no blueprint.
- **Pro: R$ 14,90/mês ou R$ 149/ano.**
- **Plano grátis sem o assistente**; até 3 metas ativas; todo o núcleo financeiro.
- **Teste grátis de 7 dias, sem cartão**, uma vez por conta, sem cobrança automática ao fim.

Valores e limites vivem em `@norbius/domain` (`billing.ts`) e são usados pela API, pela página de preços e pela tela de plano — um lugar só.

## Decisões técnicas

1. **Acesso derivado de datas, nunca armazenado.** `subscriptions` guarda `trial_ends_on` e `paid_through` (último dia coberto). `entitlements()` decide: pago até `paid_through` → Pro; cobrança vencida (`past_due`) → Pro por mais 7 dias de carência; teste até `trial_ends_on` → Pro; senão grátis. Cancelar mantém o Pro até o fim do período pago.

2. **Provedor atrás de `BillingProvider`.** `AsaasProvider` (API v3, cabeçalho `access_token`, `User-Agent`) e `FakeBillingProvider` (testes e E2E, carregado só com `BILLING_E2E_FAKE=1` **e** `APP_ENV=test`). Sem `ASAAS_API_KEY`, o checkout responde 503 com mensagem honesta; o teste grátis continua funcionando.

3. **Checkout:** cria o cliente no Asaas (uma vez; guardamos só o id), cria a assinatura com `billingType: UNDEFINED` e vencimento hoje, e redireciona para a página de pagamento do próprio Asaas (`invoiceUrl`). O cliente escolhe Pix, boleto ou cartão lá; **o NORBIUS nunca recebe dados de cartão e não guarda CPF/CNPJ** (validado com dígitos verificadores e repassado ao Asaas). Clique duplo reaproveita a cobrança pendente (linha travada com `FOR UPDATE`).

4. **Pro só com pagamento confirmado pelo webhook** (`PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`), nunca pelo retorno do navegador.

5. **Webhook** `POST /api/v1/billing/webhooks/asaas`:
   - autenticado pelo cabeçalho `asaas-access-token` (comparação em tempo constante com `ASAAS_WEBHOOK_TOKEN`);
   - idempotente: `billing_events` (id do evento como chave) é gravado na mesma transação do processamento — falhou, desfaz tudo e o Asaas reenvia;
   - o dono é resolvido por `norbius_billing_user(customer_id)` (SECURITY DEFINER, devolve só o `user_id`) e o resto roda via `withUserContext` (RLS);
   - eventos fora de ordem não “despagam” uma cobrança nem encurtam `paid_through`;
   - eventos irrelevantes ou de clientes desconhecidos respondem 200 (para não pausar a fila do Asaas) e ficam registrados;
   - `billing_events` não guarda o corpo do evento (sem dados pessoais).

6. **Limites aplicados no servidor:** assistente (`403 PLAN_REQUIRED`, antes de consumir cota), metas ativas no plano grátis (`403 PLAN_LIMIT` ao criar ou reativar, inclusive pelo assistente e pelo onboarding, que passa a aceitar no máximo 3 metas). No downgrade nada é apagado: metas acima do limite continuam visíveis e editáveis; só não é possível ativar novas.

7. **Histórico:** `billing_payments` (sem DELETE para a aplicação) alimenta o histórico de cobranças da tela de plano.

## Limitações conhecidas

- **Integração com o Asaas não foi exercitada contra o sandbox real** nesta fase (a rede do ambiente de desenvolvimento bloqueia o Asaas). Formato das chamadas conferido com os tipos gerados do OpenAPI do Asaas e coberto por testes com `fetch` simulado. **Antes de vender:** testar no sandbox o fluxo completo (assinatura, Pix, cartão, webhook) e confirmar o cabeçalho do token do webhook.
- **Estorno/chargeback** não revoga o acesso automaticamente: fica registrado e logado para análise manual (painel admin na Fase 7).
- **Trocar de mensal para anual** exige cancelar e assinar de novo após o fim do período pago.
- **Nota fiscal** não é emitida pelo NORBIUS; configurar a emissão automática de NFS-e no painel do Asaas (depende do CNPJ e do município).
- **Custo do assistente vs. preço:** o Pro inclui até `AI_MONTHLY_MESSAGE_LIMIT` mensagens (padrão 100). Medir o custo real por mensagem (tokens registrados em `ai_usage`) antes do lançamento e ajustar o limite ou o modelo (`AI_MODEL`) se necessário.
