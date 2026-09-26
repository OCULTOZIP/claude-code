# ADR 0003 — NORBIUS AI (Fase 3)

Data: 2026-09-26 · Status: aceita

## Decisões

1. **Claude via SDK oficial (`@anthropic-ai/sdk`), loop manual com streaming.** Modelo padrão `claude-opus-5` (`AI_MODEL`), `AI_EFFORT` opcional. `max_tokens` 64000 com streaming (evita timeouts). Beta `server-side-fallback-2026-07-01` com `fallbacks: "default"`: se o modelo principal estiver sobrecarregado, a API cai para outro modelo no servidor. Erros de limite/indisponibilidade viram `503 AI_UNAVAILABLE` com mensagem honesta.

2. **Sem chave, sem assistente.** Sem `ANTHROPIC_API_KEY` a rota responde 503 e a tela diz que o assistente não está ativo. Não existe modo "demonstração" com respostas fabricadas.

3. **O modelo nunca calcula nem inventa números.** Todo valor vem de uma tool que consulta o banco (com RLS via `withUserContext`). O prompt de sistema é fixo e cacheável; os dados do usuário (hoje, fuso, contas com saldo, cartões, categorias, memórias, ações recentes) vão num bloco separado `<dados_do_usuario>`, tratado como dado, não instrução. Valores em reais citados sem vir de uma tool são contados em log (sem conteúdo) para monitoramento.

4. **Três modos de tool.**
   - `read`: consultas (visão geral, busca, gastos por categoria, comparação de períodos, compromissos, cartões, metas).
   - `write`: registros simples e reversíveis (transação, compra no cartão, meta, aporte, memória). Executam na hora e devolvem um cartão com **Desfazer**.
   - `confirm`: transferência, alteração, exclusão e recorrência. Viram **ação pendente** (`ai_pending_actions`, expira em 30 min) e só executam quando o usuário clica em Confirmar. A confirmação é um `UPDATE ... WHERE status = 'pending' AND expires_at > now()` atômico: clicar duas vezes não executa duas vezes.

5. **Entrada validada em código.** Toda entrada de tool passa por Zod antes de executar (streaming ansioso de entrada pode truncar). Valores chegam em reais e são convertidos para centavos no código. Nomes (conta, cartão, categoria, meta) são resolvidos por correspondência exata → prefixo → trecho; ambiguidade ou ausência devolve `needs_clarification` e o modelo pergunta. Datas a mais de 366 dias de hoje são recusadas. Os serviços da Fase 2 são reutilizados — a IA não tem lógica financeira própria.

6. **Paradas tratadas:** `refusal` encerra a resposta; `max_tokens` com tool_use não executa a tool; JSON de entrada ilegível reemite o turno (limite de tentativas). Até `AI_MAX_TOOL_ITERATIONS` (6) voltas por mensagem.

7. **Histórico:** as últimas 20 mensagens do usuário (com respostas e resultados de tools) são reenviadas sem edição, para manter o cache de prompt válido.

8. **Cota mensal** de mensagens por usuário (`AI_MONTHLY_MESSAGE_LIMIT`, padrão 100) em `ai_usage`, com tokens registrados por mensagem. Rate limit de 20 mensagens/min por usuário.

9. **Memórias explícitas.** O assistente só guarda o que o usuário pediu para lembrar (máx. 50, 300 caracteres), visíveis e apagáveis em Configurações → Memórias do NORBIUS.

10. **Testes sem rede.** Um `LlmClient` roteirizado (`test/scripted-llm.ts`) cobre o loop, confirmações, isolamento e erros. O E2E usa um dublê determinístico (`src/testing/e2e-llm.ts`), carregado só com `AI_E2E_DOUBLE=1` **e** `APP_ENV=test` — a validação do ambiente recusa a combinação em produção. A qualidade do modelo real é medida por `pnpm --filter @norbius/api eval:ai` (34 casos pt-BR, limiar 85%), que só roda com chave, pois tem custo.

11. **Ainda não:** criptografia de campo das conversas (ficam no Postgres com RLS), voz e anexos (fotos de cupom), ações proativas. Ficam para fases posteriores.

12. **Rate limit do SSR por sessão** (correção encontrada no E2E desta fase, vale para o app todo). O SSR do Next chama a API a partir do próprio servidor, então todo usuário caía no mesmo bucket de 300 req/min do IP do servidor — com tráfego modesto, páginas passariam a falhar com 429 para todos. O Next não entrega um IP de cliente confiável ao SSR (preserva um `x-forwarded-for` enviado pelo cliente), então repassá-lo abriria falsificação. Solução: o SSR envia `x-norbius-internal` com `INTERNAL_API_SECRET` (obrigatório em staging/produção, comparação em tempo constante) e a API limita essas chamadas pelo hash do cookie de sessão; sem segredo válido o cabeçalho é ignorado e vale o IP. `getMe()` sem cookie de sessão não chama a API.
