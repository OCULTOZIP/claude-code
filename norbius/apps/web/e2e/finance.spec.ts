import { expect, test, type Page } from "@playwright/test";
import { createAccount, skipOnboarding, verifiedUser } from "./helpers";

async function money(page: Page, label: string | RegExp, value: string) {
  await page.getByLabel(label).fill(value);
}

test("onboarding conversacional configura o ambiente e mostra o resumo", async ({ page }) => {
  await verifiedUser(page, "onb");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel("Seu nome").fill("Ana");
  await page.getByRole("button", { name: "Continuar" }).click();

  await money(page, "Renda média mensal (R$)", "5.000");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "Mensal" }).click();
  await page.getByLabel("Dia do recebimento").fill("5");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Nome da conta").fill("Nubank");
  await page.getByRole("button", { name: "Adicionar conta" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "Sim, uso" }).click();
  await page.getByLabel("Nome do cartão").fill("Roxinho");
  await money(page, "Limite (R$)", "3.000");
  await page.getByLabel("Dia do fechamento").fill("3");
  await page.getByLabel("Dia do vencimento").fill("10");
  await page.getByRole("button", { name: "Adicionar cartão" }).click();
  await expect(page.getByText("Roxinho · limite R$ 3.000,00")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "Aluguel", exact: true }).click();
  await money(page, "Valor (R$)", "1.800");
  await page.getByLabel("Dia do vencimento").fill("5");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Meta").fill("Reserva");
  await money(page, "Valor (R$)", "10.000");
  await page.getByRole("button", { name: "Adicionar meta" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await money(page, "Nubank (R$)", "2.500");
  await page.getByRole("button", { name: "Concluir" }).click();

  await expect(page.getByText("Seu ambiente está pronto.")).toBeVisible();
  await expect(page.getByText(/somando R\$ 2\.500,00 \(informado por você\)/)).toBeVisible();
  await expect(page.getByText(/sobram cerca de R\$ 3\.200,00 por mês.*estimativa/)).toBeVisible();

  await page.getByRole("button", { name: "Abrir meu painel" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("R$ 2.500,00").first()).toBeVisible();
  await expect(page.getByText("Aluguel")).toBeVisible(); // compromisso futuro
  await expect(page.getByText("Reserva")).toBeVisible(); // meta
});

test("registrar despesa pelo painel, desfazer e registrar de novo", async ({ page }) => {
  await verifiedUser(page, "tx");
  await skipOnboarding(page);
  await expect(page.getByText("Cadastre suas contas para começar.")).toBeVisible();
  await createAccount(page, "Carteira", "0");
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Registrar" }).click();
  const dialog = page.getByRole("dialog");
  await money(dialog, "Valor (R$)", "50");
  await dialog.getByLabel("Descrição").fill("Mercado");
  await dialog.getByLabel("Categoria").selectOption({ label: "Alimentação" });
  await dialog.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Despesa registrada.")).toBeVisible();
  await expect(page.getByText("−R$ 50,00").or(page.getByText("-R$ 50,00")).first()).toBeVisible();

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("R$ 0,00").first()).toBeVisible();

  await page.getByRole("button", { name: "Registrar" }).click();
  await money(dialog, "Valor (R$)", "1.234,56");
  await dialog.getByLabel("Descrição").fill("Supermercado");
  await dialog.getByLabel("Categoria").selectOption({ label: "Alimentação" });
  await dialog.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Supermercado")).toBeVisible();

  await page.getByRole("link", { name: "Transações" }).first().click();
  await expect(page.getByRole("heading", { name: "Transações" })).toBeVisible();
  await page.getByLabel("Buscar").fill("super");
  await page.getByLabel("Buscar").press("Enter");
  await expect(page).toHaveURL(/q=super/);
  await expect(page.getByRole("button", { name: "Editar Supermercado" })).toBeVisible();
  const csv = page.getByRole("link", { name: "CSV" });
  await expect(csv).toHaveAttribute("href", /export\.csv\?.*q=super/);
});

test("compra parcelada no cartão aparece na fatura e pode ser paga", async ({ page }) => {
  await verifiedUser(page, "card");
  await skipOnboarding(page);
  await createAccount(page, "Corrente", "1.000");

  await page.goto("/cartoes");
  await page.getByRole("button", { name: "Cadastrar cartão" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("Visa");
  await money(dialog, "Limite (R$)", "2.000");
  await dialog.getByLabel("Dia do fechamento").fill("3");
  await dialog.getByLabel("Dia do vencimento").fill("10");
  await dialog.getByRole("button", { name: "Cadastrar cartão" }).click();
  await expect(page.getByText("Fecha dia 3 · vence dia 10")).toBeVisible();

  await page.getByRole("button", { name: "Nova compra" }).click();
  await money(dialog, "Valor (R$)", "300");
  await dialog.getByLabel("Descrição").fill("Tênis");
  await dialog.getByLabel("Categoria").selectOption({ label: "Compras" });
  await dialog.getByLabel("Parcelas").selectOption("3");
  await dialog.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Compra registrada no cartão.")).toBeVisible();
  await expect(page.getByText("R$ 1.700,00")).toBeVisible(); // limite disponível

  await page.getByRole("link", { name: "Faturas →" }).click();
  await expect(page.getByText("parcela 1/3")).toBeVisible();
  await page.getByRole("button", { name: "Pagar fatura" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByText("Pagamento registrado.")).toBeVisible();
  // A fatura segue "Aberta" até o fechamento (ainda pode receber compras),
  // mas o saldo em aberto zerou.
  await expect(page.getByText(/pago R\$ 100,00/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar fatura" })).toHaveCount(0);
});

test("metas: criar e registrar aporte", async ({ page }) => {
  await verifiedUser(page, "goal");
  await skipOnboarding(page);
  await page.goto("/metas");
  await page.getByRole("button", { name: "Criar meta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome da meta").fill("Viagem");
  await money(dialog, "Valor objetivo (R$)", "1.000");
  await dialog.getByRole("button", { name: "Criar meta" }).click();
  await page.getByRole("button", { name: "Registrar aporte" }).click();
  await money(dialog, "Valor (R$)", "250");
  await dialog.getByRole("button", { name: "Registrar aporte" }).click();
  await expect(page.getByText("Aporte registrado.")).toBeVisible();
  await expect(page.getByText("25%")).toBeVisible();
});

test("contas fixas: registrar a ocorrência pendente", async ({ page }) => {
  await verifiedUser(page, "rec");
  await skipOnboarding(page);
  await createAccount(page, "Corrente", "500");
  await page.goto("/contas/fixas");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Descrição").fill("Internet");
  await money(dialog, "Valor (R$)", "120");
  await dialog.getByLabel("Categoria").selectOption({ label: "Contas" });
  await dialog.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Internet")).toBeVisible();
  await page.getByRole("button", { name: "Registrar" }).click();
  await money(dialog, "Valor (R$)", "119,90");
  await dialog.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByText("Internet registrado.")).toBeVisible();
  await page.goto("/transacoes");
  await expect(page.getByText("− R$ 119,90")).toBeVisible();
});

test("onboarding não tem rolagem horizontal no celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await verifiedUser(page, "onbmobile");
  await page.goto("/onboarding");
  await expect(page.getByLabel("Seu nome")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
