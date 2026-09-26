import {
  NOTIFICATION_TYPE_INFO,
  NOTIFICATION_TYPES,
  notificationTypeFor,
  type NotificationPreference,
  type NotificationsList,
  type NotificationType,
} from "@norbius/contracts";
import { schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { afterQuietHours } from "@norbius/domain";
import type { Logger } from "@norbius/observability";
import { and, desc, eq, sql } from "drizzle-orm";
import { notificationEmail } from "../../lib/emails";
import type { Mailer } from "../../lib/mailer";
import { userTimezone } from "../../lib/user-context";
import { notFound } from "../../plugins/errors";

const n = schema.notifications;
const prefs = schema.notificationPreferences;
const MAX_ATTEMPTS = 5;
const LIST_LIMIT = 30;

export type NewInsight = { id: string; type: string; severity: string; title: string; body: string; fingerprint: string };

/**
 * Notificações derivadas de insights (ADR 0005, parte 2). Um aviso por
 * insight e canal (`dedup_key`); in-app sai na hora, e-mail fica pendente até
 * passar o horário silencioso e é enviado pelo job.
 */
export class NotificationsService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    private readonly log: Logger,
  ) {}

  async preferencesInTx(tx: Transaction): Promise<NotificationPreference[]> {
    const rows = await tx.select().from(prefs);
    return NOTIFICATION_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      const def = NOTIFICATION_TYPE_INFO[type];
      return { type, inApp: row?.inApp ?? def.inApp, email: row?.email ?? def.email };
    });
  }

  preferences(userId: string) {
    return withUserContext(this.db, userId, (tx) => this.preferencesInTx(tx));
  }

  async setPreferences(userId: string, list: NotificationPreference[]) {
    return withUserContext(this.db, userId, async (tx) => {
      for (const p of list) {
        await tx
          .insert(prefs)
          .values({ userId, type: p.type, inApp: p.inApp, email: p.email })
          .onConflictDoUpdate({ target: [prefs.userId, prefs.type], set: { inApp: p.inApp, email: p.email } });
      }
      return this.preferencesInTx(tx);
    });
  }

  /** Cria os avisos dos insights que acabaram de abrir (mesma transação da análise). */
  async fromInsights(tx: Transaction, userId: string, created: NewInsight[], now = new Date()) {
    if (!created.length) return;
    const preferences = await this.preferencesInTx(tx);
    const tz = await userTimezone(tx);
    const emailAt = afterQuietHours(now, tz);
    for (const i of created) {
      const type = notificationTypeFor(i.type);
      const pref = preferences.find((p) => p.type === type)!;
      const base = { userId, type, title: i.title.slice(0, 200), body: i.body.slice(0, 1000), data: { insightId: i.id, severity: i.severity } };
      if (pref.inApp) {
        await tx
          .insert(n)
          .values({ ...base, channel: "in_app", status: "sent", sentAt: now, dedupKey: `${i.fingerprint}:in_app` })
          .onConflictDoNothing();
      }
      if (pref.email) {
        await tx
          .insert(n)
          .values({ ...base, channel: "email", status: "pending", scheduledFor: emailAt, dedupKey: `${i.fingerprint}:email` })
          .onConflictDoNothing();
      }
    }
  }

  list(userId: string): Promise<NotificationsList> {
    return withUserContext(this.db, userId, async (tx) => {
      const rows = await tx.select().from(n).where(eq(n.channel, "in_app")).orderBy(desc(n.createdAt)).limit(LIST_LIMIT);
      const [{ unread }] = (await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(n)
        .where(and(eq(n.channel, "in_app"), eq(n.status, "sent")))) as [{ unread: number }];
      return {
        unread,
        items: rows.map((r) => ({
          id: r.id,
          type: r.type as NotificationType,
          title: r.title,
          body: r.body,
          severity: ((r.data as { severity?: string }).severity ?? null) as NotificationsList["items"][number]["severity"],
          read: r.status === "read",
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }

  async markRead(userId: string, id: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(n)
        .set({ status: "read", readAt: new Date() })
        .where(and(eq(n.id, id), eq(n.channel, "in_app")))
        .returning({ id: n.id });
      if (!row) throw notFound("Notificação");
    });
  }

  async markAllRead(userId: string) {
    await withUserContext(this.db, userId, (tx) =>
      tx.update(n).set({ status: "read", readAt: new Date() }).where(and(eq(n.channel, "in_app"), eq(n.status, "sent"))),
    );
  }

  /**
   * Envia os e-mails vencidos (chamado pelo job). A preferência é conferida de
   * novo no envio: quem desligou o e-mail depois do agendamento não recebe.
   */
  async dispatchDue(now = new Date(), limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
    const due = await this.db.execute<{ id: string; user_id: string }>(sql`select * from norbius_notifications_due(${now.toISOString()}::timestamptz, ${limit})`);
    const result = { sent: 0, skipped: 0, failed: 0 };
    for (const row of due) {
      await withUserContext(this.db, row.user_id, async (tx) => {
        const [item] = await tx.select().from(n).where(and(eq(n.id, row.id), eq(n.status, "pending"))).for("update");
        if (!item) return;
        const [user] = await tx
          .select({ email: schema.users.email, name: schema.users.name, verified: schema.users.emailVerified })
          .from(schema.users)
          .where(eq(schema.users.id, row.user_id));
        const pref = (await this.preferencesInTx(tx)).find((p) => p.type === item.type);
        if (!user?.verified || !pref?.email) {
          await tx.update(n).set({ status: "skipped" }).where(eq(n.id, item.id));
          result.skipped++;
          return;
        }
        try {
          await this.mailer.send(notificationEmail(user.email, user.name, item.title, item.body, this.appUrl));
          await tx.update(n).set({ status: "sent", sentAt: now, attempts: item.attempts + 1 }).where(eq(n.id, item.id));
          result.sent++;
        } catch (err) {
          const attempts = item.attempts + 1;
          this.log.warn({ err: String(err), notificationId: item.id, attempts }, "falha ao enviar notificação por e-mail");
          await tx
            .update(n)
            .set({ attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", scheduledFor: new Date(now.getTime() + attempts * 10 * 60_000) })
            .where(eq(n.id, item.id));
          result.failed++;
        }
      });
    }
    return result;
  }
}
