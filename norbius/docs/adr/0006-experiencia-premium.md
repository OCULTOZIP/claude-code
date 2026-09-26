# ADR 0006 — Experiência premium (Fase 5)

Data: 2026-09-26 · Status: aceita

## Decisões

1. **Projeção e safe-to-spend são Pro** (BLUEPRINT §14.1), corrigindo a Fase 4, que os expunha no Grátis. A projeção continua sendo calculada para todos, porque alimenta alertas (ex.: conta a vencer sem saldo previsto), mas só o Pro recebe a série, o "quanto posso gastar" e o saldo estimado no texto do CORE. A API sinaliza `projectionLocked`.

2. **Relatório mensal em PDF (Pro)** gerado sob demanda na API com PDFKit (sem armazenamento; a tabela `reports` do blueprint fica para quando houver geração assíncrona). Conteúdo: receitas, despesas e resultado, comparação com o mês anterior, taxa de poupança, despesas por categoria, 10 maiores gastos, saldo das contas no fim do mês (ou hoje, no mês corrente), faturas com vencimento no mês, metas e alertas do mês. Cartão por competência; pagamento de fatura não é despesa. Fontes padrão do PDF (WinAnsi): o texto é saneado (ex.: "−" vira "-"). Grátis: 403 com orientação para o CSV de transações. `GET /api/v1/reports/months` e `GET /api/v1/reports/monthly?month=AAAA-MM[&format=json]`.

3. **PWA.** Manifesto (`/manifest.webmanifest`), ícones gerados da marca por `ImageResponse` (`/icon`, `/apple-icon`, `/icons/192|512|maskable-512`) e service worker (`/sw.js`, registrado só em produção). O SW guarda apenas o que é público e imutável (`/_next/static`, ícones e a página `/offline`); **`/api/*` e páginas autenticadas nunca vão para o cache**. Navegação sem rede cai em `/offline`.

4. **NORBIUS CORE animado pelo estado real** (BLUEPRINT §8.3): respiração lenta em ACTIVE/STABLE, anel girando em ANALYZING, anel vermelho contido em ATTENTION, anel pontilhado à deriva em OPTIMIZING. `prefers-reduced-motion` desliga tudo (regra global). No painel o estado aparece em português e os motivos levam aos alertas.

5. **Desempenho e acessibilidade (Lighthouse mobile).**
   - Zod (~400 KB) sai do carregamento inicial das telas de autenticação e do painel: os schemas são importados só no envio do formulário, e o diálogo de registro carrega no clique (`next/dynamic`). Constantes de senha ficam em `@norbius/contracts/auth-rules`, sem zod.
   - Zod em modo `jitless` no navegador, configurado **antes** de qualquer schema ser criado (`contracts/src/zod-setup.ts`, primeiro import): sem isso o teste de `new Function` gerava violação de CSP.
   - Sem animação de entrada nem esqueleto de carregamento no painel: o servidor responde rápido e ambos atrasavam o LCP.
   - Contraste AA: `fg-muted` passou de `#66666d` para `#85858d` (≥ 4,5:1 em fundo, cartão e secundário); texto pequeno em vermelho usa `primary-light`.
   - Barras de progresso com nome acessível (`Progress` exige `label`); o gráfico de fluxo deixou de ter um botão de ~10 px por dia (alvo único de ponteiro; a tabela atende teclado e leitor de tela).

## Resultado medido

Build de produção, Lighthouse 12 mobile, nesta máquina de desenvolvimento (MacBook Air i5-8210Y, `benchmarkIndex` 880–1170):

- Acessibilidade, boas práticas e SEO: **100** nas 7 páginas medidas (início, entrar, preços, painel, assistente, transações, relatórios).
- Desempenho com a limitação padrão de CPU (4×): 76–96; painel 81–85.
- Desempenho com a limitação recomendada pelo Lighthouse para essa faixa de `benchmarkIndex` (2×): 86–99; painel 88–93.

**Pendente:** confirmar ≥ 90 no desempenho com a limitação padrão numa máquina de referência ou no ambiente de staging (Fase 8). Nesta máquina o custo de avaliar o React domina o TBT mesmo em páginas estáticas.
