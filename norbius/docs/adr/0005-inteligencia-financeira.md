# ADR 0005 — Inteligência financeira (Fase 4)

Data: 2026-09-26 · Status: aceita

## Escopo desta parte

**Parte 1:** projeção de saldo, "quanto posso gastar?", detectores de insights, estado real do NORBIUS CORE, painel e ferramentas do assistente.
**Parte 2:** notificações (no app e por e-mail), preferências por tipo, horário silencioso e análise diária agendada.
**Fora desta fase:** reescrita dos textos pela IA a partir de `evidence` (Pro) e push.

## Decisões técnicas

1. **Regras puras em `@norbius/intelligence`.** Projeção, safe-to-spend, os 11 detectores do BLUEPRINT §13 e o estado do CORE são funções puras (sem banco), testadas isoladamente. A API só carrega os dados e persiste o resultado. Mesma entrada → mesma saída: o bootstrap usa semente derivada da entrada (mulberry32 + FNV-1a).

2. **Execução sob demanda, sem worker.** `IntelligenceService.summary()` roda ao abrir o painel (`/dashboard/summary` já traz a inteligência) ou `GET /api/v1/intelligence`, e quando o assistente usa `get_cash_projection`/`list_insights`. Custo: poucas consultas + 1.000 cenários × 30 dias em memória. Como o cálculo é síncrono, o CORE nunca é exibido como `ANALYZING` por um processamento que não existe; o estado fica reservado para o job da parte 2.

3. **Projeção (método v1).**
   - Horizonte de 30 dias; linha base = saldo das contas do dia a dia + eventos datados (recorrências pendentes, faturas em aberto, lançamentos futuros). Eventos atrasados caem no primeiro dia projetado.
   - Gasto variável = despesas sem recorrência dos últimos 90 dias (contas e compras no cartão **no dia da compra**, o que antecipa a saída de caixa e deixa a curva conservadora).
   - Dias fora do padrão são **limitados** (não descartados) em mediana + 3,5·MAD normalizado; quando o MAD zera, o desvio absoluto médio faz o papel de escala.
   - Incerteza por bootstrap de dias históricos do mesmo dia da semana → p10/p50/p90 por dia. O gasto médio exibido é a média dos dias (já limitados), não a mediana: com muitos dias sem gasto a mediana seria zero e subestimaria o gasto.
   - Oculta com menos de 14 dias de histórico (mensagem honesta). Confiança: baixa (< 30 dias ou renda irregular), média (30–89), alta (≥ 90 e renda regular). Premissas sempre acompanham o resultado.

4. **Safe-to-spend.** Vale até a véspera da próxima receita prevista (ou fim do mês). `disponível = saldo + entradas previstas − compromissos − aportes de metas proporcionais ao período − reserva (10% da renda média declarada)`. Diferente da fórmula literal do blueprint, **não parte do p50**: o p50 já desconta o gasto variável estimado, e o objetivo é justamente o orçamento para esse gasto. Nunca sugere valor diário negativo; sempre rotulado como estimativa.

5. **Insights.**
   - `fingerprint` = tipo + escopo + período, único por usuário (`ON CONFLICT` atualiza texto e evidência).
   - Tipos de **condição** viram `resolved` quando a condição some; tipos de **evento** (`anomaly`, `goal_reached`, `monthly_summary`) só expiram (`expires_at`) ou são dispensados.
   - Dispensado continua dispensado mesmo se a condição persistir no mesmo período; um período novo gera novo fingerprint.
   - Plano Grátis: `bill_due`, `card_limit`, `goal_reached`, `monthly_summary`; Pro: todos. Downgrade resolve os demais.
   - Recorrência atrasada não gera `bill_due` (pode ter sido paga sem registro); fatura vencida gera, como crítica.
   - Texto 100% por template, com os números da `evidence`.

6. **Persistência e RLS.** Tabelas `insights`, `projection_snapshots` e `core_state_events` com RLS por usuário. A aplicação não apaga insights nem histórico do CORE; snapshots são cache (gravados só quando a projeção muda, podados após 35 dias). O CORE registra evento só quando muda de estado ou de motivos.

7. **Assistente.** `get_cash_projection` (projeção + safe-to-spend, sempre `kind: estimate`, com premissas) e `list_insights`. O prompt aponta para elas; os casos de avaliação de "quanto posso gastar" e "vai sobrar" passaram a esperá-las.

8. **Notificações (parte 2).** Derivam só de insights que **abrem pela primeira vez** (fingerprint inédito): reabrir o mesmo período não avisa de novo. Uma linha por insight e canal (`dedup_key = fingerprint:canal`, único por usuário). Tipos (BLUEPRINT §4.7): `bill_due`, `card_limit`, `goal_reached`, `unusual_spending` (anomalia), `financial_summary` (resumo do mês), `insight` (demais). Padrões: todos no app; e-mail ligado para contas, limite, gastos fora do padrão e resumo; desligado para metas e demais análises. No app sai na hora; e-mail fica `pending` até passar o **horário silencioso (22h–8h no fuso do usuário)**. No envio a preferência é conferida de novo (quem desligou depois recebe `skipped`); falhas tentam de novo com espera crescente, até 5 vezes (`failed`). A aplicação não apaga notificações.

9. **Jobs no processo da API.** `Jobs.tick()` a cada 5 minutos: análise diária de quem já passou das **06:00 locais** e ainda não foi analisado no dia (`intelligence_runs`), o que também cobre o fechamento do mês (o resumo nasce no dia 1º), e envio dos e-mails vencidos. Sem sessão, os jobs descobrem **só ids** por funções `SECURITY DEFINER` (`norbius_intelligence_due`, `norbius_notifications_due`); todo o resto roda por `withUserContext` (RLS). Um tick por vez no processo; com várias instâncias, `JOBS_ENABLED=true` em só uma. A falha na análise de um usuário ainda marca o dia, para não repetir a cada tick.

## Limitações conhecidas

- Sem `RESEND_API_KEY` os e-mails de aviso vão para o log da API (desenvolvimento).
- O CORE não passa por `ANALYZING` durante o job diário: a análise de cada usuário leva milissegundos e o estado é recalculado ao abrir o painel.

- Sem receita recorrente cadastrada, a projeção não prevê salário: o usuário vê isso nas premissas e o safe-to-spend vai até o fim do mês.
- Compras parceladas entram no gasto variável pelo valor total no dia da compra; parcelas futuras já lançadas em faturas também aparecem como fatura — pode haver dupla contagem conservadora no horizonte de 30 dias quando há parcelamentos grandes recentes.
- `category_increase` compara com o mesmo intervalo do mês anterior mesmo quando o histórico começou no meio desse mês.
