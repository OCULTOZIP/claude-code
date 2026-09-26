import { schema, type Database } from "@norbius/db";
import { entitlements, PRO_PRICE_CENTS, todayIn } from "@norbius/domain";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { passwordHasher } from "../../lib/password";
import { HttpError, notFound } from "../../plugins/errors";
import { decrypt, randomToken, sha256, signChallenge, verifyChallenge } from "./crypto";
import { verifyTotp } from "./totp";

const a = schema.adminUsers;
const s = schema.adminSessions;

export type AdminRole = (typeof schema.ADMIN_ROLES)[number];
export type AdminIdentity = { id: string; email: string; name: string; role: AdminRole };

export const SESSION_TTL_MS = 8 * 3_600_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const invalid = () => new HttpError(401, "INVALID_CREDENTIALS", "E-mail, senha ou código inválidos.");
const forbidden = () => new HttpError(403, "FORBIDDEN", "Seu papel de administrador não permite esta ação.");

/** Erros das funções do banco viram respostas claras (papel, motivo, autorização). */
function fromDb(err: unknown): never {
  const e = (err as { cause?: { code?: string; message?: string } }).cause ?? (err as { code?: string; message?: string });
  if (e?.code === "42501") throw new HttpError(403, "FORBIDDEN", e.message?.includes("autorização") ? "Autorização do usuário inválida ou expirada." : "Seu papel de administrador não permite esta ação.");
  if (e?.code === "22023") throw new HttpError(400, "VALIDATION_ERROR", e.message?.includes("motivo") ? "Informe um motivo com pelo menos 5 caracteres." : "Valor inválido.");
  if (e?.code === "P0002") throw notFound("Usuário");
  throw err;
}

/**
 * Painel admin (Fase 7, ADR 0007). Usa SÓ a conexão `norbius_admin`, que não
 * tem acesso a dados financeiros: o isolamento é garantido pelo banco.
 */
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly key: Buffer,
    private readonly passwords: typeof passwordHasher,
  ) {}

  /** Hash de verdade para comparar quando o e-mail não existe (mesmo tempo de resposta). */
  private dummy: Promise<string> | null = null;

  // ── Autenticação (senha → código TOTP → sessão de 8 h) ────────────
  async passwordStep(email: string, password: string): Promise<string> {
    const [admin] = await this.db.select().from(a).where(eq(a.email, email.trim().toLowerCase()));
    if (!admin || !admin.active) {
      this.dummy ??= this.passwords.hash(randomToken());
      await this.passwords.verify({ hash: await this.dummy, password });
      throw invalid();
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw new HttpError(429, "LOCKED", "Muitas tentativas. Tente de novo em alguns minutos.");
    if (!(await this.passwords.verify({ hash: admin.passwordHash, password }))) {
      await this.fail(admin.id, admin.failedAttempts);
      throw invalid();
    }
    return signChallenge(this.key, admin.id);
  }

  async totpStep(challenge: string, code: string, meta: { ip: string | null; userAgent: string | null }) {
    const id = verifyChallenge(this.key, challenge);
    if (!id) throw new HttpError(401, "CHALLENGE_EXPIRED", "A etapa de senha expirou. Entre de novo.");
    const [admin] = await this.db.select().from(a).where(eq(a.id, id));
    if (!admin || !admin.active) throw invalid();
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw new HttpError(429, "LOCKED", "Muitas tentativas. Tente de novo em alguns minutos.");
    const step = verifyTotp(decrypt(this.key, admin.totpSecret), code, admin.totpLastStep);
    if (step === null) {
      await this.fail(admin.id, admin.failedAttempts);
      throw invalid();
    }
    const token = randomToken();
    await this.db.transaction(async (tx) => {
      await tx.update(a).set({ totpLastStep: step, failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(a.id, id));
      await tx.insert(s).values({ adminUserId: id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip: meta.ip, userAgent: meta.userAgent });
    });
    await this.audit(id, "admin.auth.login", null, {}, null, meta.ip);
    return { token, admin: { id, email: admin.email, name: admin.name, role: admin.role } };
  }

  private async fail(id: string, previous: number) {
    const failures = previous + 1;
    await this.db
      .update(a)
      .set({ failedAttempts: failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null })
      .where(eq(a.id, id));
    await this.audit(id, "admin.auth.failed", null, { failures }, null, null);
  }

  async session(token: string | undefined): Promise<AdminIdentity | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({ id: a.id, email: a.email, name: a.name, role: a.role, active: a.active })
      .from(s)
      .innerJoin(a, eq(a.id, s.adminUserId))
      .where(and(eq(s.tokenHash, sha256(token)), isNull(s.revokedAt), gt(s.expiresAt, new Date())));
    return row && row.active ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;
  }

  async logout(token: string) {
    await this.db.update(s).set({ revokedAt: new Date() }).where(eq(s.tokenHash, sha256(token)));
  }

  assertRole(admin: AdminIdentity, roles: AdminRole[]) {
    if (admin.role !== "superadmin" && !roles.includes(admin.role)) throw forbidden();
  }

  async audit(adminId: string, action: string, subjectUserId: string | null, metadata: Record<string, unknown>, requestId: string | null, ip: string | null) {
    await this.db.insert(schema.auditLogs).values({ actorType: "admin", actorId: adminId, subjectUserId, action, metadata, requestId, ip: ip && /^[0-9a-f:.]+$/i.test(ip) ? ip : null });
  }

  // ── Métricas ───────────────────────────────────────────────────
  async metrics() {
    const [m] = await this.db.execute<Record<string, number | string>>(sql`select * from admin_metrics`);
    const subs = await this.db
      .select({ cycle: schema.subscriptions.cycle, paidThrough: schema.subscriptions.paidThrough })
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.paidThrough} >= current_date`);
    // MRR: anual conta 1/12 por mês. Valores em centavos, dos preços do plano.
    const mrrCents = subs.reduce((sum, x) => sum + (x.cycle === "yearly" ? Math.round(PRO_PRICE_CENTS.yearly / 12) : PRO_PRICE_CENTS.monthly), 0);
    const num = (k: string) => Number(m?.[k] ?? 0);
    return {
      users: { total: num("total_users"), verified: num("verified_users"), new7d: num("new_7d"), new30d: num("new_30d"), suspended: num("suspended") },
      active: { d1: num("active_1d"), d7: num("active_7d"), d30: num("active_30d") },
      subscriptions: {
        paying: num("paying"),
        trialing: num("trialing"),
        trialsStarted: num("trials_started"),
        trialsConverted: num("trials_converted"),
        conversion: num("trials_started") ? num("trials_converted") / num("trials_started") : null,
        canceled30d: num("canceled_30d"),
        mrrCents,
      },
      ai: { messagesMonth: num("ai_messages_month"), tokensMonth: num("ai_tokens_month") },
    };
  }

  // ── Clientes (cadastro e assinatura; nada financeiro) ─────────────
  async customers(q: { search?: string | undefined; status?: string | undefined; plan?: string | undefined; page: number }) {
    const pageSize = 25;
    const where = [
      q.search ? sql`(email ilike ${`%${q.search.replace(/[%_\\]/g, "\\$&")}%`} or name ilike ${`%${q.search.replace(/[%_\\]/g, "\\$&")}%`})` : sql`true`,
      q.status ? sql`status = ${q.status}` : sql`true`,
    ];
    const rows = await this.db.execute<CustomerRow>(sql`
      select * from admin_customers where ${sql.join(where, sql` and `)}
      order by created_at desc limit ${pageSize + 1} offset ${(q.page - 1) * pageSize}`);
    const list = [...rows].map(toCustomer).filter((c) => !q.plan || c.plan === q.plan);
    return { items: list.slice(0, pageSize), hasMore: rows.length > pageSize };
  }

  async customer(id: string) {
    const [row] = await this.db.execute<CustomerRow>(sql`select * from admin_customers where id = ${id}`);
    if (!row) throw notFound("Usuário");
    const payments = await this.db
      .select()
      .from(schema.billingPayments)
      .where(eq(schema.billingPayments.userId, id))
      .orderBy(desc(schema.billingPayments.dueDate))
      .limit(24);
    const grants = await this.db
      .select()
      .from(schema.supportAccessGrants)
      .where(eq(schema.supportAccessGrants.userId, id))
      .orderBy(desc(schema.supportAccessGrants.grantedAt))
      .limit(10);
    const now = new Date();
    return {
      ...toCustomer(row),
      payments: payments.map((p) => ({ id: p.id, amountCents: p.amountCents, status: p.status, dueDate: p.dueDate, paidAt: p.paidAt?.toISOString() ?? null })),
      grants: grants.map((g) => ({
        id: g.id,
        scope: g.scope,
        reason: g.reason,
        grantedAt: g.grantedAt.toISOString(),
        expiresAt: g.expiresAt.toISOString(),
        active: !g.revokedAt && g.expiresAt > now,
      })),
    };
  }

  // ── Ações auditadas (conferidas de novo no banco) ─────────────────
  async setUserStatus(admin: AdminIdentity, userId: string, status: "active" | "suspended", reason: string, requestId: string) {
    this.assertRole(admin, ["support"]);
    await this.db.execute(sql`select norbius_admin_set_user_status(${admin.id}, ${userId}, ${status}, ${reason}, ${requestId})`).catch(fromDb);
  }

  async grantTrial(admin: AdminIdentity, userId: string, days: number, reason: string, requestId: string) {
    this.assertRole(admin, ["billing"]);
    const [row] = await this.db
      .execute<{ trial_ends_on: string }>(sql`select norbius_admin_grant_trial(${admin.id}, ${userId}, ${days}, ${reason}, ${requestId})::text as trial_ends_on`)
      .catch(fromDb);
    return { trialEndsOn: row!.trial_ends_on };
  }

  async supportTransactions(admin: AdminIdentity, grantId: string, requestId: string) {
    this.assertRole(admin, ["support"]);
    const rows = await this.db
      .execute<{ tx_date: string; tx_description: string; tx_type: string; amount_cents: string; category_name: string | null; account_name: string | null }>(
        sql`select tx_date::text, tx_description, tx_type, amount_cents, category_name, account_name from norbius_support_transactions(${admin.id}, ${grantId}, 100, ${requestId})`,
      )
      .catch(fromDb);
    return [...rows].map((r) => ({ date: r.tx_date, description: r.tx_description, type: r.tx_type, amountCents: Number(r.amount_cents), category: r.category_name, account: r.account_name }));
  }

  // ── Assinaturas, registro de atividades e admins ──────────────────
  async payments(page: number) {
    const pageSize = 50;
    const rows = await this.db
      .select({ p: schema.billingPayments, email: sql<string>`(select email from admin_customers c where c.id = ${schema.billingPayments.userId})` })
      .from(schema.billingPayments)
      .orderBy(desc(schema.billingPayments.dueDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return rows.map(({ p, email }) => ({ id: p.id, userId: p.userId, email, amountCents: p.amountCents, status: p.status, dueDate: p.dueDate, paidAt: p.paidAt?.toISOString() ?? null }));
  }

  async auditLog(q: { action?: string | undefined; userId?: string | undefined; page: number }) {
    const pageSize = 50;
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      select id, actor_type, actor_id, subject_user_id, action, entity_type, metadata, host(ip) as ip, created_at
      from admin_audit_logs
      where ${q.action ? sql`action like ${`${q.action.replace(/[%_\\]/g, "\\$&")}%`}` : sql`true`}
        and ${q.userId ? sql`subject_user_id = ${q.userId}` : sql`true`}
      order by created_at desc limit ${pageSize} offset ${(q.page - 1) * pageSize}`);
    return [...rows].map((r) => ({ ...r, id: Number(r.id), created_at: new Date(r.created_at as string).toISOString() }));
  }

  async admins() {
    return this.db
      .select({ id: a.id, email: a.email, name: a.name, role: a.role, active: a.active, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt })
      .from(a)
      .orderBy(a.createdAt);
  }

  async setAdminActive(actor: AdminIdentity, id: string, active: boolean, requestId: string) {
    this.assertRole(actor, []);
    if (id === actor.id) throw new HttpError(400, "VALIDATION_ERROR", "Você não pode desativar a própria conta.");
    const [row] = await this.db.update(a).set({ active }).where(eq(a.id, id)).returning({ id: a.id });
    if (!row) throw notFound("Administrador");
    if (!active) await this.db.update(s).set({ revokedAt: new Date() }).where(and(eq(s.adminUserId, id), isNull(s.revokedAt)));
    await this.audit(actor.id, active ? "admin.admin.activate" : "admin.admin.deactivate", null, { adminId: id }, requestId, null);
  }
}

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  onboarding_status: string | null;
  timezone: string | null;
  subscription_status: string | null;
  cycle: string | null;
  trial_started_at: string | null;
  trial_ends_on: string | null;
  paid_through: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
};

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
const day = (v: string | Date | null) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

function toCustomer(r: CustomerRow) {
  const ent = entitlements(
    {
      status: (r.subscription_status ?? "none") as never,
      trialEndsOn: day(r.trial_ends_on),
      paidThrough: day(r.paid_through),
      cancelAtPeriodEnd: !!r.cancel_at_period_end,
    },
    todayIn(r.timezone ?? "America/Sao_Paulo"),
  );
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: r.email_verified,
    status: r.status,
    createdAt: iso(r.created_at)!,
    lastSeenAt: iso(r.last_seen_at),
    onboarding: r.onboarding_status,
    plan: ent.plan,
    planReason: ent.reason,
    proUntil: ent.proUntil,
    subscriptionStatus: r.subscription_status ?? "none",
    cycle: r.cycle,
    trialEndsOn: day(r.trial_ends_on),
    paidThrough: day(r.paid_through),
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
  };
}
