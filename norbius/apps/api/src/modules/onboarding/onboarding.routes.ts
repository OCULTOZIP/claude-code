import { onboardingCompleteSchema, onboardingDraftSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import type { RequireUser } from "../../plugins/session";
import type { OnboardingService } from "./onboarding.service";

export function registerOnboardingRoutes(app: FastifyInstance, service: OnboardingService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/onboarding", opts, async (req) => service.state(req.user!.id));
  app.put("/api/v1/onboarding/draft", opts, async (req) => service.saveDraft(req.user!.id, onboardingDraftSchema.parse(req.body)));
  app.post("/api/v1/onboarding/complete", opts, async (req) =>
    service.complete(req.user!.id, onboardingCompleteSchema.parse(req.body), req.id),
  );
  app.post("/api/v1/onboarding/skip", opts, async (req) => service.skip(req.user!.id, req.id));
}
