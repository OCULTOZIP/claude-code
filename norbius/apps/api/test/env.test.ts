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
      /RESEND_API_KEY[\s\S]*REDIS_URL[\s\S]*https/,
    );
  });

  it("proíbe a caixa de saída em arquivo em produção", () => {
    expect(() =>
      loadEnv({ ...base, APP_ENV: "production", RESEND_API_KEY: "k", REDIS_URL: "redis://r:6379", MAIL_OUTBOX_DIR: "/tmp/x" }),
    ).toThrow(/MAIL_OUTBOX_DIR/);
  });

  it("liga HIBP por padrão em produção", () => {
    const env = loadEnv({ ...base, APP_ENV: "production", RESEND_API_KEY: "k", REDIS_URL: "redis://r:6379" });
    expect(env.HIBP_ENABLED).toBe(true);
  });

  it("exige as duas credenciais do Google juntas", () => {
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("trata variáveis vazias como não definidas", () => {
    const env = loadEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "" });
    expect(env.googleEnabled).toBe(false);
  });

  it("rejeita segredo curto", () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: "curto" })).toThrow(/32/);
  });
});
