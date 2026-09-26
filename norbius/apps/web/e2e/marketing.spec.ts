import { expect, test } from "@playwright/test";

test("landing apresenta o NORBIUS e leva ao cadastro", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Seu dinheiro.");
  await expect(page.getByText("Conheça o NORBIUS, seu sistema de inteligência financeira pessoal.")).toBeVisible();
  await expect(page.getByText("Exemplo ilustrativo")).toBeVisible();
  await page.getByRole("link", { name: "Começar agora" }).first().click();
  await expect(page).toHaveURL(/\/cadastro$/);
});

test("páginas institucionais respondem", async ({ page }) => {
  for (const [path, heading] of [
    ["/precos", "Simples e transparente."],
    ["/faq", "Perguntas frequentes"],
    ["/privacidade", "Política de Privacidade"],
    ["/termos", "Termos de Uso"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("cabeçalhos de segurança estão presentes", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
});
