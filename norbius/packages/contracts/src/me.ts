import { z } from "zod";
import { nameSchema } from "./auth";

export const onboardingStatusSchema = z.enum(["not_started", "in_progress", "completed", "skipped"]);

export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    createdAt: z.string(),
  }),
  profile: z.object({
    displayName: z.string().nullable(),
    timezone: z.string(),
    locale: z.string(),
    onboardingStatus: onboardingStatusSchema,
  }),
});
export type Me = z.infer<typeof meSchema>;

export const updateProfileSchema = z.object({
  displayName: nameSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const authConfigSchema = z.object({
  providers: z.object({ google: z.boolean() }),
});
export type AuthConfig = z.infer<typeof authConfigSchema>;
