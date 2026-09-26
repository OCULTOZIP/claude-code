import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

const base = {
  APP_URL: "https://app.norbius.com.br",
  DATABASE_URL: "postgres://u:p@db:5432/norbius",
  BETTER_AUTH_SECRET: "x".repeat(40),
};

describe("loadEnv", () => {
  it("aceita configuração mínima de desenvolvimento", () => {
    const env = loadEnv({ ...base, APP_URL: "http://localhost:3000" });
    expect(env.APP_ENV).toBe("development");
    expect(env.HIBP_ENABLED).toBe(false);
    expect(env.googleEnabled).toBe(false);
  });

  it("exige e-mail real, Redis e https em produção", () => {
    expect(() => loadEnv({ ...base, APP_ENV: "production", APP_URL: "http://x" })).toThrow(
      /RESEND_API_KEY[\s\S]*REDIS_URL[\s\S]*INTERNAL_API_SECRET[\s\S]*https/,
    );
  });

  it("proíbe a caixa de saída em arquivo em produção", () => {
    expect(() =>
      loadEnv({ ...base, APP_ENV: "production", RESEND_API_KEY: "k", REDIS_URL: "redis://r:6379", INTERNAL_API_SECRET: "s".repeat(32), MAIL_OUTBOX_DIR: "/tmp/x" }),
    ).toThrow(/MAIL_OUTBOX_DIR/);
  });

  it("liga HIBP por padrão em produção", () => {
    const env = loadEnv({ ...base, APP_ENV: "production", RESEND_API_KEY: "k", REDIS_URL: "redis://r:6379", INTERNAL_API_SECRET: "s".repeat(32) });
    expect(env.HIBP_ENABLED).toBe(true);
  });

  it("exige as duas credenciais do Google juntas", () => {
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("trata variáveis vazias como não definidas", () => {
    const env = loadEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "" });
    expect(env.googleEnabled).toBe(false);
  });

  it("proíbe o dublê de LLM fora de testes", () => {
    expect(() => loadEnv({ ...base, APP_ENV: "development", AI_E2E_DOUBLE: "1" })).toThrow(/AI_E2E_DOUBLE/);
    expect(loadEnv({ ...base, APP_ENV: "test", AI_E2E_DOUBLE: "1" }).AI_E2E_DOUBLE).toBe("1");
  });

  it("rejeita segredo curto", () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: "curto" })).toThrow(/32/);
  });

  it("pagamento: provedor falso só em teste; Asaas exige token do webhook e ambiente de produção", () => {
    expect(() => loadEnv({ ...base, BILLING_E2E_FAKE: "1" })).toThrow(/BILLING_E2E_FAKE/);
    expect(() => loadEnv({ ...base, ASAAS_API_KEY: "k" })).toThrow(/ASAAS_WEBHOOK_TOKEN/);
    const prod = { ...base, APP_ENV: "production", RESEND_API_KEY: "k", REDIS_URL: "redis://r:6379", INTERNAL_API_SECRET: "s".repeat(32) };
    expect(() => loadEnv({ ...prod, ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t".repeat(32) })).toThrow(/ASAAS_ENV/);
    expect(loadEnv({ ...prod, ASAAS_API_KEY: "k", ASAAS_WEBHOOK_TOKEN: "t".repeat(32), ASAAS_ENV: "production" }).ASAAS_ENV).toBe("production");
  });
});
