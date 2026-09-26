# ADR 0002 — Núcleo financeiro (Fase 2)

Data: 2026-09-26 · Status: aceita

## Decisões

1. **Datas de calendário como strings ISO (`YYYY-MM-DD`)** em todo o domínio (`@norbius/domain`). Nada de `Date` para datas financeiras: evita deslocamentos de fuso. "Hoje" é sempre calculado no fuso do perfil do usuário.

2. **Saldo derivado, nunca armazenado.** `saldo = saldo inicial + movimentações com data entre a data do saldo inicial e hoje`. Lançamentos futuros aparecem como compromissos e não afetam o saldo atual. Não existe campo de saldo editável solto.

3. **Cartão sem dupla contagem.** A despesa é contada na compra, por parcela, pela data de competência de cada parcela. O pagamento da fatura é uma **transferência** da conta para o cartão (`type = transfer`, `credit_card_invoice_id`): reduz o saldo da conta e libera limite, mas não é despesa.

4. **Regra de fatura:** compras até o dia anterior ao fechamento entram na fatura do mês; no dia do fechamento ou depois, na seguinte. Vencimento no mesmo mês se o dia de vencimento for maior que o de fechamento; senão, no mês seguinte. Dia 31 é limitado ao fim do mês. **Status da fatura é derivado** (aberta, fechada, paga, parcialmente paga, vencida), nunca armazenado. Mudar fechamento/vencimento do cartão vale para faturas novas.

5. **Limite usado** = todas as parcelas de compras ativas (inclusive futuras) − pagamentos de faturas do cartão.

6. **Recorrências não são materializadas.** A próxima ocorrência pendente é calculada (`last_handled_date` + regra). O usuário **registra** (cria a transação ou compra real, podendo ajustar o valor) ou **pula**. Sem worker nesta fase; nada é lançado automaticamente sem ação do usuário.

7. **Metas:** valor atual = soma dos aportes (retiradas são aportes negativos). Status "concluída" é sincronizado com o total. Aportes registram o que foi separado; não movimentam saldo de contas nesta fase.

8. **Exclusão lógica** (`deleted_at`) para transações e compras, com "Desfazer" na interface.

9. **Defesa em profundidade no banco:** RLS em todas as tabelas; FKs compostas `(user_id, id)` entre tabelas do usuário (impossível referenciar conta/cartão/fatura de outro usuário); trigger `norbius_check_category` garante categoria do sistema ou própria e do tipo certo. Erros de integridade viram 400 genérico na API.

10. **`qualified()` em subconsultas correlacionadas.** Em selects de uma tabela só, o Drizzle omite o nome da tabela nas colunas; dentro de uma subconsulta, `"id"` passaria a apontar para a tabela interna. Isso zerava saldos silenciosamente e foi pego pelos testes de integração. Toda subconsulta correlacionada usa `qualified(coluna)`.

11. **CSV** em pt-BR (`;`, vírgula decimal, BOM) com proteção contra injeção de fórmulas (valores iniciados por `= + - @` viram texto, exceto números).

12. **Onboarding determinístico** (máquina de estados na UI, sem LLM), rascunho salvo no servidor (`profiles.onboarding_draft`), conclusão em uma única transação. Renda informada vira receita recorrente **marcada como estimativa**. O resumo usa só o que foi informado e diz o que falta.

13. **NORBIUS CORE nesta fase fica em `ACTIVE`**, com motivo real (sem contas / sem movimentações / N dias de histórico). Estados de análise dependem do motor de insights (Fase 4) e não são simulados.

14. **Gráfico de fluxo:** paleta validada com o validador de acessibilidade de cores (modo escuro, superfície `#121214`): receitas `#3B82F6`, despesas `#E50914`. Legenda sempre visível, tooltip por dia e visualização em tabela.

15. **Dados na interface:** páginas buscam no servidor (RSC) e mutações usam `fetch` + `router.refresh()`. Não adotamos TanStack Query nesta fase (menos dependências; reavaliar quando houver streaming de IA na Fase 3).

## Adiado

- Criptografia em nível de campo para `notes` (depende de KMS; Fase 8).
- Materialização automática de recorrências e alertas (worker, Fase 4).
- Importação OFX/CSV (Fase 9 ou antes, reaproveitando o mesmo pipeline).
