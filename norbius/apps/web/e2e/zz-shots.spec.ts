import { expect, test } from "@playwright/test";
import { latestLink, uniqueEmail } from "./mail";

const DIR = process.env.SHOTS_DIR;
test.skip(!DIR, "somente com SHOTS_DIR");

test("capturas", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: `${DIR}/landing.png`, fullPage: true });
  await page.goto("/entrar");
  await page.screenshot({ path: `${DIR}/entrar.png` });
  const email = uniqueEmail("shots");
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("uma-senha-bem-forte-2026");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
  await page.goto(await latestLink(email, /Confirme/));
  await page.goto("/dashboard");
  await page.screenshot({ path: `${DIR}/dashboard.png`, fullPage: true });
  await page.goto("/configuracoes/seguranca");
  await expect(page.getByText("Este dispositivo")).toBeVisible();
  await page.screenshot({ path: `${DIR}/seguranca.png`, fullPage: true });
});
