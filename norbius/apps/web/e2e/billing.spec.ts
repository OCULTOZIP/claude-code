import { expect, test } from "@playwright/test";
import { E2E_API_URL, E2E_WEBHOOK_TOKEN } from "../playwright.config";
import { skipOnboarding, verifiedUser } from "./helpers";

test("preços públicos refletem o plano real", async ({ page }) => {
  await page.goto("/precos");
  await expect(page.getByText("R$ 14,90")).toBeVisible();
  await expect(page.getByText(/R\$ 149,00 por ano/)).toBeVisible();
  await expect(page.getByText("Até 3 metas ativas")).toBeVisible();
});

test("plano grátis limita metas e aponta para o Pro", async ({ page }) => {
  await verifiedUser(page, "free-goals");
  await skipOnboarding(page);
  for (const n of [1, 2, 3]) {
    const res = await page.request.post("/api/v1/goals", { data: { name: `Meta ${n}`, targetAmountCents: 10000 } });
    expect(res.status()).toBe(201);
  }
  await page.goto("/metas");
  await page.getByRole("button", { name: "Nova meta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome da meta").fill("Viagem");
  await dialog.getByLabel("Valor objetivo (R$)").fill("5.000");
  await dialog.getByRole("button", { name: "Criar meta" }).click();
  await expect(dialog.getByText(/O plano grátis permite até 3 metas ativas/)).toBeVisible();
  await dialog.getByRole("link", { name: "Ver planos" }).click();
  await expect(page.getByRole("heading", { name: "Plano grátis" })).toBeVisible();
});

test("assinar o Pro anual, confirmar o pagamento e cancelar", async ({ page }) => {
  await verifiedUser(page, "subscribe");
  await skipOnboarding(page);
  await page.goto("/configuracoes/plano");
  await expect(page.getByRole("heading", { name: "Plano grátis" })).toBeVisible();

  await page.getByText("Anual", { exact: true }).click();
  await page.getByLabel("CPF ou CNPJ").fill("111.111.111-11");
  await page.getByRole("button", { name: "Continuar para o pagamento" }).click();
  await expect(page.getByText("Informe um CPF ou CNPJ válido.")).toBeVisible();

  await page.getByLabel("CPF ou CNPJ").fill("529.982.247-25");
  await page.getByRole("button", { name: "Continuar para o pagamento" }).click();

  // O provedor falso "leva ao pagamento" de volta para cá; o acesso ainda não foi liberado.
  await expect(page).toHaveURL(/cobranca=/);
  await expect(page.getByText(/Cobrança de R\$ 149,00/)).toBeVisible();
  await expect(page.getByText("Aguardando pagamento")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plano grátis" })).toBeVisible();

  // Webhook do provedor confirmando o pagamento (Pix).
  const url = new URL(page.url());
  const res = await page.request.post(`${E2E_API_URL}/api/v1/billing/webhooks/asaas`, {
    headers: { "asaas-access-token": E2E_WEBHOOK_TOKEN },
    data: {
      id: `evt_${Date.now()}`,
      event: "PAYMENT_RECEIVED",
      payment: {
        id: url.searchParams.get("cobranca"),
        customer: url.searchParams.get("cliente"),
        value: 149,
        status: "RECEIVED",
        billingType: "PIX",
        dueDate: url.searchParams.get("venc"),
      },
    },
  });
  expect((await res.json()).outcome).toBe("paid");

  await page.goto("/configuracoes/plano");
  await expect(page.getByRole("heading", { name: "Pro · anual" })).toBeVisible();
  await expect(page.getByText("Pago", { exact: true })).toBeVisible();
  await expect(page.getByText("Pix")).toBeVisible();

  // Com o Pro, o assistente fica disponível.
  await page.goto("/norbius");
  await expect(page.getByLabel("Mensagem para o NORBIUS")).toBeVisible();

  await page.goto("/configuracoes/plano");
  await page.getByRole("button", { name: "Cancelar assinatura" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.getByRole("heading", { name: "Pro · assinatura cancelada" })).toBeVisible();
});
