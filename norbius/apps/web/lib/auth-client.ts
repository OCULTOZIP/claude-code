"use client";
import { createAuthClient } from "better-auth/react";

// Mesma origem: o proxy do Next repassa /api/auth/* para a API.
export const authClient = createAuthClient({ basePath: "/api/auth" });

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha inválidos.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail para entrar. Enviamos um novo link para sua caixa de entrada.",
  USER_ALREADY_EXISTS: "Não foi possível concluir o cadastro. Tente entrar ou recuperar sua senha.",
  PASSWORD_TOO_SHORT: "A senha é muito curta.",
  PASSWORD_TOO_LONG: "A senha é muito longa.",
  INVALID_TOKEN: "Este link é inválido ou expirou. Solicite um novo.",
  TOKEN_EXPIRED: "Este link expirou. Solicite um novo.",
  INVALID_PASSWORD: "Senha atual incorreta.",
  TERMS_NOT_ACCEPTED: "É preciso aceitar os Termos e a Política de Privacidade.",
  PASSWORD_COMPROMISED: "Esta senha apareceu em vazamentos conhecidos. Escolha outra.",
};

/** Traduz erros do Better Auth para mensagens em pt-BR. */
export function authErrorMessage(error: { code?: string; status?: number; message?: string } | null | undefined) {
  if (!error) return "Algo deu errado. Tente novamente.";
  if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]!;
  if (error.status === 403) return MESSAGES.EMAIL_NOT_VERIFIED!;
  return "Algo deu errado. Tente novamente.";
}
