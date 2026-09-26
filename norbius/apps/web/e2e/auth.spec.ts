import { expect, test, type Page } from "@playwright/test";
import { latestLink, uniqueEmail } from "./mail";

const PASSWORD = "uma-senha-bem-forte-2026";

async function signUp(page: Page, email: string, name = "Ana Souza") {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
}

test("rota protegida redireciona para o login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fdashboard/);
});

test("cadastro valida campos no cliente", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Informe seu nome.")).toBeVisible();
  await expect(page.getByText("É preciso aceitar os Termos e a Política de Privacidade.")).toBeVisible();
});

test("fluxo completo: cadastro, verificação, painel, perfil, sessões e logout", async ({ page }) => {
  const email = uniqueEmail("flow");
  await signUp(page, email);

  // Login antes de verificar é bloqueado com aviso.
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/Confirme seu e-mail para entrar/)).toBeVisible();

  // Verificação pelo link do e-mail abre a sessão.
  await page.goto(await latestLink(email, /Confirme seu e-mail/));
  await expect(page.getByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir meu painel" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Ana." })).toBeVisible();
  await expect(page.getByRole("img", { name: "NORBIUS CORE: Ativo" })).toBeVisible();
  await expect(page.getByText("Sem registros").first()).toBeVisible();

  // Perfil
  await page.getByRole("link", { name: "Configurações" }).first().click();
  await page.getByLabel("Como o NORBIUS deve chamar você").fill("Aninha");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Perfil atualizado.")).toBeVisible();
  await page.getByRole("link", { name: "Painel" }).first().click();
  await expect(page.getByRole("heading", { name: "Aninha." })).toBeVisible();

  // Sessões
  await page.goto("/configuracoes/seguranca");
  await expect(page.getByText("Este dispositivo")).toBeVisible();

  // Logout
  await page.getByRole("button", { name: "Sair" }).first().click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/entrar/);
});

test("recuperação de senha pelo e-mail", async ({ page }) => {
  const email = uniqueEmail("reset");
  await signUp(page, email, "Bruno");
  await page.goto(await latestLink(email, /Confirme seu e-mail/));
  await expect(page.getByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
  await page.context().clearCookies();

  await page.goto("/entrar");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByText(/Se existir uma conta com esse e-mail/)).toBeVisible();

  await page.goto(await latestLink(email, /Redefinição de senha/));
  await expect(page).toHaveURL(/\/redefinir-senha\?token=/);
  await page.getByLabel("Nova senha", { exact: true }).fill("nova-senha-forte-2026");
  await page.getByLabel("Confirme a nova senha").fill("nova-senha-forte-2026");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Senha redefinida" })).toBeVisible();

  await page.getByRole("link", { name: "Entrar" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("nova-senha-forte-2026");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("link de redefinição inválido mostra orientação", async ({ page }) => {
  await page.goto("/redefinir-senha?error=INVALID_TOKEN");
  await expect(page.getByRole("heading", { name: "Link inválido" })).toBeVisible();
});

test("não há redirecionamento aberto após login", async ({ page }) => {
  const email = uniqueEmail("redirect");
  await signUp(page, email, "Caio");
  await page.goto(await latestLink(email, /Confirme seu e-mail/));
  await expect(page.getByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
  await page.context().clearCookies();

  await page.goto("/entrar?next=//evil.example.com");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/dashboard");
});
