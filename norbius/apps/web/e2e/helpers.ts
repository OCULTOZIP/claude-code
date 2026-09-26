import { expect, type Page } from "@playwright/test";
import { latestLink, uniqueEmail } from "./mail";

export const PASSWORD = "uma-senha-bem-forte-2026";

/** Cadastra e verifica um usuário; a página termina autenticada. */
export async function verifiedUser(page: Page, tag: string, name = "Ana Souza") {
  const email = uniqueEmail(tag);
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
  await page.goto(await latestLink(email, /Confirme seu e-mail/));
  await expect(page.getByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
  return email;
}

/** Pula o onboarding (sem criar nada) e chega ao painel. */
export async function skipOnboarding(page: Page) {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Pular configuração" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Cadastra uma conta pela tela de Contas. */
export async function createAccount(page: Page, name: string, initial: string) {
  await page.goto("/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial (R$)").fill(initial);
  await dialog.getByRole("button", { name: "Cadastrar conta" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
