import type { Me } from "@norbius/contracts";
import type { AuditLogger } from "../../lib/audit";
import { notFound } from "../../plugins/errors";
import type { MeRepository } from "./me.repository";

export class MeService {
  constructor(
    private readonly repo: MeRepository,
    private readonly audit: AuditLogger,
  ) {}

  async getMe(userId: string): Promise<Me> {
    const [user, profile] = await Promise.all([this.repo.findUser(userId), this.repo.findProfile(userId)]);
    if (!user || !profile) throw notFound("Usuário");
    return { user: { ...user, createdAt: user.createdAt.toISOString() }, profile };
  }

  async updateProfile(userId: string, input: { displayName: string }, requestId: string): Promise<Me> {
    const updated = await this.repo.updateDisplayName(userId, input.displayName);
    if (!updated) throw notFound("Perfil");
    await this.audit.record({
      actorType: "user",
      actorId: userId,
      subjectUserId: userId,
      action: "profile.update",
      entityType: "profile",
      entityId: userId,
      metadata: { fields: ["displayName"] },
      requestId,
    });
    return this.getMe(userId);
  }
}
