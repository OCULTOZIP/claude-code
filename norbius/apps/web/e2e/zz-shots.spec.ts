import { expect, test } from "@playwright/test";
import { createAccount, skipOnboarding, verifiedUser } from "./helpers";

// Utilitário de revisão visual: só roda com SHOTS_DIR definido.
const DIR = process.env.SHOTS_DIR;
test.skip(!DIR, "somente com SHOTS_DIR");

test("capturas", async ({ page }) => {
  test.setTimeout(120_000);
  await verifiedUser(page, "shots");
  await page.goto("/onboarding");
  await page.getByLabel("Seu nome").fill("Ana");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Renda média mensal (R$)").fill("6.200");
  await page.screenshot({ path: `${DIR}/onboarding.png`, fullPage: true });
  await skipOnboarding(page);
  await createAccount(page, "Nubank", "8.420,15");
  await createAccount(page, "Reserva", "12.000");

  const register = async (amount: string, desc: string, cat: string, type = "Despesa") => {
    await page.goto("/transacoes");
    await page.getByRole("button", { name: "Registrar" }).first().click();
    const d = page.getByRole("dialog");
    await d.getByRole("tab", { name: type }).click();
    await d.getByLabel("Valor (R$)").fill(amount);
    await d.getByLabel("Descrição").fill(desc);
    await d.getByLabel("Categoria").selectOption({ label: cat });
    await d.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(page.getByText(`${type} registrada.`)).toBeVisible();
  };
  await register("6.200", "Salário", "Salário", "Receita");
  await register("412,90", "Supermercado", "Alimentação");
  await register("89,90", "Uber", "Transporte");
  await register("1.800", "Aluguel", "Moradia");
  await register("39,90", "Streaming", "Assinaturas");

  await page.goto("/cartoes");
  await page.getByRole("button", { name: "Cadastrar cartão" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nome").fill("Roxinho");
  await d.getByLabel("Limite (R$)").fill("5.000");
  await d.getByLabel("Dia do fechamento").fill("3");
  await d.getByLabel("Dia do vencimento").fill("10");
  await d.getByRole("button", { name: "Cadastrar cartão" }).click();
  await page.getByRole("button", { name: "Nova compra" }).click();
  await d.getByLabel("Valor (R$)").fill("2.400");
  await d.getByLabel("Descrição").fill("Notebook");
  await d.getByLabel("Categoria").selectOption({ label: "Compras" });
  await d.getByLabel("Parcelas").selectOption("6");
  await d.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Compra registrada no cartão.")).toBeVisible();

  await page.goto("/metas");
  await page.getByRole("button", { name: "Criar meta" }).click();
  await d.getByLabel("Nome da meta").fill("Viagem para o Chile");
  await d.getByLabel("Valor objetivo (R$)").fill("8.000");
  await d.getByRole("button", { name: "Criar meta" }).click();
  await page.getByRole("button", { name: "Registrar aporte" }).click();
  await d.getByLabel("Valor (R$)").fill("2.600");
  await d.getByRole("button", { name: "Registrar aporte" }).click();
  await expect(page.getByText("Aporte registrado.")).toBeVisible();

  for (const [path, name] of [
    ["/dashboard", "dashboard"],
    ["/transacoes", "transacoes"],
    ["/cartoes", "cartoes"],
    ["/metas", "metas"],
    ["/contas", "contas"],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
  }
});

test("capturas do chat", async ({ page }) => {
  await verifiedUser(page, "shotschat");
  await skipOnboarding(page);
  await createAccount(page, "Corrente", "3.000");
  await createAccount(page, "Reserva", "0");
  await page.goto("/norbius");
  await page.screenshot({ path: `${DIR}/chat-bloqueado.png` });
  await page.getByRole("button", { name: "Começar teste grátis" }).click();
  await expect(page.getByLabel("Mensagem para o NORBIUS")).toBeVisible();
  await page.screenshot({ path: `${DIR}/chat-vazio.png` });
  const input = page.getByLabel("Mensagem para o NORBIUS");
  await input.fill("Gastei 50 no mercado");
  await input.press("Enter");
  await expect(page.getByText("Registrei R$ 50,00 em Alimentação.")).toBeVisible();
  await input.fill("transfere 200 para a reserva");
  await input.press("Enter");
  await expect(page.getByText("Confirmar transferência")).toBeVisible();
  await page.screenshot({ path: `${DIR}/chat.png` });
});

test("capturas do plano", async ({ page }) => {
  await verifiedUser(page, "shotsplan");
  await skipOnboarding(page);
  await page.goto("/precos");
  await page.screenshot({ path: `${DIR}/precos.png`, fullPage: true });
  await page.goto("/configuracoes/plano");
  await page.screenshot({ path: `${DIR}/plano-gratis.png`, fullPage: true });
  await page.getByLabel("CPF ou CNPJ").fill("529.982.247-25");
  await page.getByRole("button", { name: "Continuar para o pagamento" }).click();
  await expect(page.getByText("Aguardando pagamento")).toBeVisible();
  await page.screenshot({ path: `${DIR}/plano-pendente.png`, fullPage: true });
});
