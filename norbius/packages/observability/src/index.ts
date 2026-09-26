import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Caminhos sempre removidos dos logs. Dados financeiros, credenciais e PII
 * nunca devem ser logados; esta lista é a rede de segurança, não a regra.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "newPassword",
  "*.newPassword",
  "currentPassword",
  "*.currentPassword",
  "token",
  "*.token",
  "email",
  "*.email",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.amount",
  "*.amountCents",
  "*.description",
  "*.notes",
];

export function createLogger(options: LoggerOptions & { service: string }): Logger {
  const { service, ...rest } = options;
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service, env: process.env.APP_ENV ?? "development" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...rest,
  });
}

export type { Logger };
