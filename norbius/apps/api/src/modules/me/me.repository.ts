import { schema, withUserContext, type Database } from "@norbius/db";
import { eq } from "drizzle-orm";

export class MeRepository {
  constructor(private readonly db: Database) {}

  async findUser(userId: string) {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        image: schema.users.image,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user ?? null;
  }

  /** Perfil do usuário. RLS garante que só o próprio perfil é visível. */
  findProfile(userId: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [profile] = await tx
        .select({
          displayName: schema.profiles.displayName,
          timezone: schema.profiles.timezone,
          locale: schema.profiles.locale,
          onboardingStatus: schema.profiles.onboardingStatus,
        })
        .from(schema.profiles);
      return profile ?? null;
    });
  }

  updateDisplayName(userId: string, displayName: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(schema.profiles)
        .set({ displayName })
        .where(eq(schema.profiles.userId, userId))
        .returning({ userId: schema.profiles.userId });
      return row ?? null;
    });
  }
}
