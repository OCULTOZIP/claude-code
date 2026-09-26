import { describe, expect, it } from "vitest";
import { changePasswordSchema, emailSchema, signUpSchema } from "../src";

describe("emailSchema", () => {
  it("normaliza para minúsculas e remove espaços", () => {
    expect(emailSchema.parse("  Ana@Exemplo.COM ")).toBe("ana@exemplo.com");
  });
  it("rejeita e-mail inválido", () => {
    expect(emailSchema.safeParse("ana@").success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const valid = { name: "Ana", email: "ana@exemplo.com", password: "senha-forte-123", acceptTerms: true };

  it("aceita cadastro válido", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });
  it("exige senha com pelo menos 10 caracteres", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "curta" }).success).toBe(false);
  });
  it("exige aceite dos termos", () => {
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("exige confirmação igual", () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: "x",
      newPassword: "nova-senha-123",
      confirmPassword: "outra-senha-123",
    });
    expect(r.success).toBe(false);
  });
});
