import { expect, test } from "@playwright/test";
import { createAccount, skipOnboarding, verifiedUser } from "./helpers";

test("chat com o NORBIUS: registrar, desfazer, confirmar transferência e retomar a conversa", async ({ page }) => {
  await verifiedUser(page, "chat");
  await skipOnboarding(page);
  await createAccount(page, "Corrente", "1.000");
  await createAccount(page, "Reserva", "0");

  await page.getByRole("link", { name: "NORBIUS", exact: true }).first().click();
  await expect(page.getByText("Olá, Ana. Como posso ajudar?")).toBeVisible();

  const input = page.getByLabel("Mensagem para o NORBIUS");
  await input.fill("Gastei 50 no mercado");
  await input.press("Enter");
  await expect(page.getByText("Despesa registrada")).toBeVisible();
  await expect(page.getByText("Registrei R$ 50,00 em Alimentação.")).toBeVisible();
  await expect(page).toHaveURL(/\/norbius\?c=/);

  // Retomar: o histórico volta após recarregar.
  await page.reload();
  await expect(page.locator("ol").getByText("Gastei 50 no mercado")).toBeVisible();
  await expect(page.getByText("Registrei R$ 50,00 em Alimentação.")).toBeVisible();

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Desfeito")).toBeVisible();

  await input.fill("transfere 200 para a reserva");
  await input.press("Enter");
  await expect(page.getByText("Confirmar transferência")).toBeVisible();
  await expect(page.getByText("Corrente → Reserva")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Transferência registrada")).toBeVisible();

  await page.goto("/contas");
  const reserva = page.locator("div", { has: page.getByText("Reserva", { exact: true }) }).filter({ hasText: "R$" }).last();
  await expect(reserva).toContainText("R$ 200,00");
});

test("resposta com dado real vem da consulta", async ({ page }) => {
  await verifiedUser(page, "chat2");
  await skipOnboarding(page);
  await createAccount(page, "Corrente", "1.234,56");
  await page.goto("/norbius");
  await page.getByLabel("Mensagem para o NORBIUS").fill("qual meu saldo?");
  await page.getByLabel("Mensagem para o NORBIUS").press("Enter");
  await expect(page.getByText("Seu saldo disponível é R$ 1.234,56.")).toBeVisible();
});
