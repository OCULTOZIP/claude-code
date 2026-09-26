import { formatBRL } from "@norbius/domain";
import PDFDocument from "pdfkit";
import type { MonthlyReport } from "./reports.service";

// Papel branco (imprime bem); vermelho da marca só em destaques.
const INK = "#111114";
const MUTED = "#6B6B73";
const LINE = "#E4E4E7";
const RED = "#E50914";
const BAR = "#3B82F6";
const M = 48;

/** Fontes padrão do PDF usam WinAnsi: troca o que ficaria fora dela. */
const safe = (s: string) =>
  s
    .replace(/−/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\u0000-ÿ–—‘’“”•€]/g, "");
const brl = (c: number) => safe(formatBRL(c));
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const monthTitle = (m: string) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const SEVERITY: Record<string, string> = { critical: "Crítico", attention: "Atenção", opportunity: "Oportunidade", info: "Info" };

export function renderMonthlyPdf(r: MonthlyReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `NORBIUS — ${monthTitle(r.month)}`, Author: "NORBIUS" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - M * 2;
  const bottom = () => doc.page.height - M - 24;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // Cabeçalho
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("NORBIUS", M, M, { characterSpacing: 3, continued: true }).fillColor(RED).text(".");
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Relatório mensal", M, M + 3, { width: W, align: "right" });
  doc.moveDown(2.2);
  doc.font("Helvetica-Bold").fontSize(24).fillColor(INK).text(safe(monthTitle(r.month)), M);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(safe(`${r.name ? `${r.name} · ` : ""}${r.partial ? `Mês em andamento: valores até ${br(r.generatedOn)}` : "Mês fechado"}`));
  doc.moveDown(1.5);

  // Resumo
  const result = r.incomeCents - r.expenseCents;
  const boxes = [
    { label: "Receitas", value: brl(r.incomeCents), color: INK },
    { label: "Despesas", value: brl(r.expenseCents), color: INK },
    { label: result >= 0 ? "Sobrou" : "Faltou", value: brl(Math.abs(result)), color: result >= 0 ? INK : RED },
  ];
  const bw = (W - 16) / 3;
  const top = doc.y;
  boxes.forEach((b, i) => {
    const x = M + i * (bw + 8);
    doc.roundedRect(x, top, bw, 58, 8).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(b.label, x + 12, top + 12, { width: bw - 24 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(b.color).text(b.value, x + 12, top + 28, { width: bw - 24 });
  });
  doc.y = top + 70;
  doc.x = M;
  const prevExp = r.previous.expenseCents;
  const diff = r.expenseCents - prevExp;
  const savings = r.incomeCents > 0 ? Math.round((result / r.incomeCents) * 100) : null;
  const notes = [
    prevExp > 0
      ? `Despesas ${diff >= 0 ? "maiores" : "menores"} que em ${monthTitle(r.previous.month).split(" de ")[0]!.toLowerCase()}: ${diff >= 0 ? "+" : "-"}${brl(Math.abs(diff))} (${diff >= 0 ? "+" : ""}${Math.round((diff / prevExp) * 100)}%).`
      : null,
    savings !== null ? `Taxa de poupança: ${savings}% da receita.` : null,
    r.partial ? "Comparação feita com o mês anterior inteiro." : null,
  ].filter(Boolean) as string[];
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(safe(notes.join("  ·  ")), { width: W });
  doc.moveDown(1.2);

  const section = (title: string) => {
    ensure(60);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(safe(title), M);
    doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.moveDown(0.8);
  };
  const empty = (text: string) => doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(safe(text), M, doc.y, { width: W });
  /** Linha de tabela com colunas [texto, largura, alinhamento]. */
  const row = (cols: [string, number, "left" | "right"][], opts: { bold?: boolean; color?: string; size?: number } = {}) => {
    ensure(18);
    const y = doc.y;
    let x = M;
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 9.5).fillColor(opts.color ?? INK);
    for (const [text, w, align] of cols) {
      doc.text(safe(text), x, y, { width: w, align, lineBreak: false, ellipsis: true });
      x += w;
    }
    doc.y = y + 16;
  };

  section("Despesas por categoria");
  if (!r.categories.length) empty("Sem despesas registradas no mês.");
  for (const c of r.categories.slice(0, 12)) {
    ensure(20);
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(safe(c.name), M, y, { width: 150, lineBreak: false, ellipsis: true });
    const barX = M + 158;
    const barW = W - 158 - 150;
    doc.roundedRect(barX, y + 2, barW, 7, 3.5).fillColor("#F4F4F5").fill();
    if (c.share > 0) doc.roundedRect(barX, y + 2, Math.max(3, barW * c.share), 7, 3.5).fillColor(BAR).fill();
    doc.fillColor(INK).text(brl(c.cents), M + W - 140, y, { width: 90, align: "right" });
    doc.fillColor(MUTED).text(`${Math.round(c.share * 100)}%`, M + W - 45, y, { width: 45, align: "right" });
    doc.y = y + 18;
  }

  section("Maiores gastos");
  if (!r.topExpenses.length) empty("Sem despesas registradas no mês.");
  else row([["Data", 62, "left"], ["Descrição", W - 62 - 130 - 90, "left"], ["Categoria", 130, "left"], ["Valor", 90, "right"]], { color: MUTED, size: 8.5 });
  for (const e of r.topExpenses) {
    row([
      [br(e.date).slice(0, 5), 62, "left"],
      [`${e.description}${e.card ? " (cartão)" : ""}`, W - 62 - 130 - 90, "left"],
      [e.category, 130, "left"],
      [brl(e.cents), 90, "right"],
    ]);
  }

  section(r.partial ? "Saldo das contas hoje" : "Saldo das contas no fim do mês");
  if (!r.accounts.length) empty("Nenhuma conta cadastrada.");
  for (const a of r.accounts) row([[a.name, W - 120, "left"], [brl(a.balanceCents), 120, "right"]], { color: a.balanceCents < 0 ? RED : INK });

  section("Faturas com vencimento no mês");
  if (!r.invoices.length) empty("Nenhuma fatura venceu neste mês.");
  for (const i of r.invoices) {
    const open = i.totalCents - i.paidCents;
    row([
      [i.card, W - 90 - 100 - 100, "left"],
      [`vence ${br(i.dueDate).slice(0, 5)}`, 90, "left"],
      [`total ${brl(i.totalCents)}`, 100, "right"],
      [open > 0 ? `em aberto ${brl(open)}` : "paga", 100, "right"],
    ]);
  }

  section("Metas");
  if (!r.goals.length) empty("Nenhuma meta ativa.");
  for (const g of r.goals) row([[g.name, W - 220, "left"], [`${brl(g.currentCents)} de ${brl(g.targetCents)}`, 170, "right"], [`${Math.round(g.progress * 100)}%`, 50, "right"]]);

  section("Alertas do mês");
  if (!r.insights.length) empty("Nenhum alerta gerado neste mês.");
  for (const i of r.insights) row([[SEVERITY[i.severity] ?? i.severity, 80, "left"], [i.title, W - 80, "left"]], { color: i.severity === "critical" ? RED : INK });

  // Rodapé em todas as páginas
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Sem isso o PDFKit abre página nova ao escrever abaixo da margem inferior.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - M + 8;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(safe(`NORBIUS · gerado em ${br(r.generatedOn)} · valores em reais, com dados registrados por você`), M, y, { width: W - 60, lineBreak: false })
      .text(`${i + 1}/${range.count}`, M + W - 60, y, { width: 60, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
