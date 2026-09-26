import { schema, type Database } from "@norbius/db";

export type AuditEntry = {
  actorType: "user" | "admin" | "system" | "ai";
  actorId?: string | null;
  subjectUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

const IP_RE = /^[0-9a-f:.]+$/i;

export class AuditLogger {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry) {
    await this.db.insert(schema.auditLogs).values({
      ...entry,
      ip: entry.ip && IP_RE.test(entry.ip) ? entry.ip : null,
      metadata: entry.metadata ?? {},
    });
  }
}
