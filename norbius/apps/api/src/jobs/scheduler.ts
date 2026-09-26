import { schema, withUserContext, type Database } from "@norbius/db";
import { localParts } from "@norbius/domain";
import type { Logger } from "@norbius/observability";
import { sql } from "drizzle-orm";
import { userTimezone } from "../lib/user-context";
import type { IntelligenceService } from "../modules/intelligence/intelligence.service";
import type { NotificationsService } from "../modules/notifications/notifications.service";

/** Hora local da análise diária (BLUEPRINT §13). */
export const DAILY_HOUR = 6;
const BATCH = 100;

/**
 * Jobs agendados no próprio processo da API (ADR 0005, parte 2): análise
 * diária às 06:00 no fuso de cada usuário (cobre o fechamento do mês, que
 * gera o resumo no dia 1º) e envio dos e-mails pendentes. Um tick por vez; em
 * produção com várias instâncias, só uma deve ter JOBS_ENABLED=true.
 */
export class Jobs {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly intelligence: IntelligenceService,
    private readonly notifications: NotificationsService,
    private readonly log: Logger,
  ) {}

  /** Analisa quem já passou das 06:00 locais e ainda não foi analisado hoje. */
  async runDailyAnalysis(now = new Date()): Promise<number> {
    const due = await this.db.execute<{ user_id: string }>(
      sql`select user_id from norbius_intelligence_due(${now.toISOString()}::timestamptz, ${DAILY_HOUR}, ${BATCH})`,
    );
    for (const { user_id: userId } of due) {
      try {
        await this.intelligence.summary(userId, now);
      } catch (err) {
        this.log.error({ err, userId }, "falha na análise diária");
      } finally {
        // Marca mesmo com falha: tenta de novo amanhã em vez de repetir a cada tick.
        await withUserContext(this.db, userId, async (tx) => {
          const today = localParts(now, await userTimezone(tx)).date;
          await tx
            .insert(schema.intelligenceRuns)
            .values({ userId, lastDailyRunOn: today })
            .onConflictDoUpdate({ target: schema.intelligenceRuns.userId, set: { lastDailyRunOn: today } });
        });
      }
    }
    return due.length;
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const analyzed = await this.runDailyAnalysis(now);
      const mail = await this.notifications.dispatchDue(now);
      if (analyzed || mail.sent || mail.failed || mail.skipped) this.log.info({ analyzed, ...mail }, "jobs: tick");
    } catch (err) {
      this.log.error({ err }, "jobs: falha no tick");
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 5 * 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    setTimeout(() => void this.tick(), 10_000).unref();
    this.log.info({ intervalMs }, "jobs: agendador iniciado");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
