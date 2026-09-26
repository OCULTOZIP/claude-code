import type { ApiError } from "@norbius/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Sessão inválida ou expirada.");
export const notFound = (what = "Recurso") => new HttpError(404, "NOT_FOUND", `${what} não encontrado.`);
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

/**
 * Erros de integridade do Postgres (FK composta, check, trigger de categoria)
 * viram 400 com mensagem genérica: o banco é a última barreira, e a API não
 * revela detalhes de dados de outros usuários.
 */
function fromPostgres(err: unknown): HttpError | null {
  const cause = (err as { cause?: { code?: string } }).cause ?? (err as { code?: string });
  switch (cause?.code) {
    case "23503":
      return badRequest("INVALID_REFERENCE", "Referência inválida: conta, cartão ou categoria não encontrada.");
    case "23514":
      return badRequest("CONSTRAINT_VIOLATION", "Dados inconsistentes para esta operação.");
    case "23505":
      return conflict("ALREADY_EXISTS", "Já existe um registro com esses dados.");
    default:
      return null;
  }
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { error: { code: "NOT_FOUND", message: "Rota não encontrada.", requestId: req.id } };
    reply.status(404).send(body);
  });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
      const body: ApiError = {
        error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", requestId: req.id, fields },
      };
      return reply.status(400).send(body);
    }
    const pg = err instanceof HttpError ? null : fromPostgres(err);
    if (pg) {
      const body: ApiError = { error: { code: pg.code, message: pg.message, requestId: req.id } };
      return reply.status(pg.statusCode).send(body);
    }
    if (err instanceof HttpError) {
      const body: ApiError = { error: { code: err.code, message: err.message, requestId: req.id } };
      return reply.status(err.statusCode).send(body);
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "erro não tratado");
    const body: ApiError = {
      error: {
        code: status === 429 ? "RATE_LIMITED" : status >= 500 ? "INTERNAL_ERROR" : (err.code ?? "BAD_REQUEST"),
        // Nunca vazar detalhes internos em erros 5xx.
        message:
          status === 429
            ? "Muitas requisições. Tente novamente em instantes."
            : status >= 500
              ? "Erro interno. Tente novamente."
              : err.message,
        requestId: req.id,
      },
    };
    return reply.status(status).send(body);
  });
}
