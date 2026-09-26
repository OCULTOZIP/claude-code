import { expect, test } from "@playwright/test";

// Em conexões lentas o usuário pode enviar o formulário antes de o React
// hidratar a página. Nesse caso o envio nativo não pode vazar credenciais
// na URL, e o botão deve ficar desabilitado até a hidratação.
test("formulário de login não vaza senha na URL antes da hidratação", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/_next/static/chunks/**", async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto("/entrar", { waitUntil: "commit" });
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await page.getByLabel("E-mail").fill("alguem@test.norbius");
  await page.getByLabel("Senha").fill("senha-secreta-123");
  const submit = page.getByRole("button", { name: "Entrar" });
  await expect(submit).toBeDisabled();
  await submit.click({ force: true });

  expect(page.url()).not.toContain("senha-secreta");
  expect(page.url()).not.toContain("password");

  release();
  await expect(submit).toBeEnabled();
});
