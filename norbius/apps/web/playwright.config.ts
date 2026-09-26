import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// E2E contra a stack real: API (Postgres real) + web (build de produção).
export const OUTBOX_DIR = process.env.E2E_OUTBOX_DIR ?? join(tmpdir(), "norbius-e2e-outbox");
const WEB_URL = "http://localhost:3100";
const API_PORT = "4100";

// SSR do web se identifica para a API (rate limit por sessão, não pelo IP do servidor).
const INTERNAL_API_SECRET = "e2e-internal-secret-with-32-characters!";

export const E2E_API_URL = `http://localhost:${API_PORT}`;
export const E2E_WEBHOOK_TOKEN = "e2e-webhook-token-with-32-characters!!";

const apiEnv = {
  APP_ENV: "test",
  APP_URL: WEB_URL,
  PORT: API_PORT,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius",
  BETTER_AUTH_SECRET: "e2e-secret-with-at-least-32-characters!!",
  AUTH_RATE_LIMIT_ENABLED: "false",
  INTERNAL_API_SECRET,
  MAIL_OUTBOX_DIR: OUTBOX_DIR,
  // Dublê determinístico do LLM (só permitido com APP_ENV=test).
  AI_E2E_DOUBLE: "1",
  // Provedor de pagamento falso (só permitido com APP_ENV=test); o E2E simula o webhook.
  BILLING_E2E_FAKE: "1",
  ASAAS_WEBHOOK_TOKEN: E2E_WEBHOOK_TOKEN,
  LOG_LEVEL: "warn",
};

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: WEB_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(responsive\.spec|zz-shots\.spec)\.ts/ },
  ],
  webServer: [
    {
      command: "pnpm --filter @norbius/api exec tsx src/server.ts",
      url: `http://localhost:${API_PORT}/api/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm exec next start --port 3100",
      url: WEB_URL,
      env: { API_URL: `http://localhost:${API_PORT}`, APP_URL: WEB_URL, INTERNAL_API_SECRET },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
