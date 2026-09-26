import { expect, test } from "@playwright/test";

test("landing e login não têm rolagem horizontal no celular", async ({ page }) => {
  for (const path of ["/", "/entrar", "/cadastro", "/precos"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
