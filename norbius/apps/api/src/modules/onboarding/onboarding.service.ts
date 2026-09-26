import type { OnboardingState, OnboardingSummary } from "@norbius/contracts";
import { onboardingCompleteSchema, onboardingDraftSchema } from "@norbius/contracts";
import { schema, withUserContext, type Database } from "@norbius/db";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { userToday } from "../../lib/user-context";
import { badRequest, conflict } from "../../plugins/errors";
import type { AccountsRepository } from "../accounts/accounts.repository";
import type { CardsService } from "../cards/cards.service";
import { systemCategory } from "../categories/categories.service";
import type { GoalsService } from "../goals/goals.service";
import type { RecurringService } from "../recurring/recurring.service";

const profiles = schema.profiles;
const MAX_DRAFT_BYTES = 20_000;

export class OnboardingService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountsRepository,
    private readonly cards: CardsService,
    private readonly recurring: RecurringService,
    private readonly goals: GoalsService,
    private readonly audit: AuditLogger,
  ) {}

  state(userId: string): Promise<OnboardingState> {
    return withUserContext(this.db, userId, async (tx) => {
      const [p] = await tx.select().from(profiles);
      return {
        status: p?.onboardingStatus ?? "not_started",
        step: (p?.onboardingStep as OnboardingState["step"]) ?? null,
        draft: (p?.onboardingDraft as Record<string, unknown> | null) ?? null,
      };
    });
  }

  /** Salva o progresso para retomar depois (em qualquer dispositivo). */
  async saveDraft(userId: string, input: z.infer<typeof onboardingDraftSchema>) {
    if (JSON.stringify(input.data).length > MAX_DRAFT_BYTES) throw badRequest("DRAFT_TOO_LARGE", "Rascunho muito grande.");
    await withUserContext(this.db, userId, async (tx) => {
      const [p] = await tx.select({ status: profiles.onboardingStatus }).from(profiles);
      if (p?.status === "completed") throw conflict("ONBOARDING_DONE", "O onboarding já foi concluído.");
      await tx
        .update(profiles)
        .set({ onboardingStatus: "in_progress", onboardingStep: input.step, onboardingDraft: input.data })
        .where(eq(profiles.userId, userId));
    });
    return this.state(userId);
  }

  async skip(userId: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      await tx
        .update(profiles)
        .set({ onboardingStatus: "skipped", onboardingDraft: null, onboardingStep: null })
        .where(eq(profiles.userId, userId));
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "onboarding.skip", requestId });
    return this.state(userId);
  }

  /** Cria tudo que foi informado numa única transação e devolve o resumo inicial. */
  async complete(userId: string, input: z.infer<typeof onboardingCompleteSchema>, requestId: string): Promise<OnboardingSummary> {
    const summary = await withUserContext(this.db, userId, async (tx) => {
      const [p] = await tx.select().from(profiles);
      if (p?.onboardingStatus === "completed") throw conflict("ONBOARDING_DONE", "O onboarding já foi concluído.");
      const today = await userToday(tx);

      await tx
        .update(profiles)
        .set({
          displayName: input.displayName,
          avgMonthlyIncomeCents: input.income?.avgMonthlyCents ?? null,
          incomeFrequency: input.income?.frequency ?? null,
          incomeDays: input.income?.days.length ? input.income.days : null,
          onboardingStatus: "completed",
          onboardingStep: null,
          onboardingDraft: null,
          onboardingCompletedAt: new Date(),
        })
        .where(eq(profiles.userId, userId));

      // Contas (sem nenhuma, cria uma carteira para não bloquear o uso).
      const accountInputs = input.accounts.length
        ? input.accounts
        : [{ name: "Carteira", type: "wallet" as const, initialBalanceCents: null }];
      const accountIds: string[] = [];
      for (const acc of accountInputs) {
        const row = await this.accounts.insert(tx, {
          userId,
          name: acc.name,
          type: acc.type,
          initialBalanceCents: acc.initialBalanceCents ?? 0,
          initialBalanceDate: today,
          includeInAvailableBalance: acc.type !== "investment",
          source: "onboarding",
        });
        accountIds.push(row.id);
      }
      const primaryAccount = accountIds[0]!;

      for (const card of input.cards) {
        await this.cards.createInTx(tx, userId, { ...card, brand: null, lastFour: null, defaultPaymentAccountId: primaryAccount }, "onboarding");
      }

      let fixedMonthly = 0;
      for (const fx of input.fixedExpenses) {
        const category = await systemCategory(tx, fx.categoryKey, "expense");
        await this.recurring.createInTx(
          tx,
          userId,
          {
            type: "expense",
            accountId: primaryAccount,
            creditCardId: null,
            amountCents: fx.amountCents,
            amountIsEstimate: false,
            categoryId: category.id,
            description: fx.description,
            frequency: "monthly",
            dayOfMonth: fx.dayOfMonth,
            startDate: today,
            endDate: null,
          },
          "onboarding",
        );
        fixedMonthly += fx.amountCents;
      }

      // Receita recorrente estimada: só para renda regular com dia(s) informado(s).
      const income = input.income;
      if (income?.createRecurring && income.avgMonthlyCents && income.days.length) {
        const salary = await systemCategory(tx, "salario", "income");
        const parts =
          income.frequency === "biweekly" && income.days.length === 2
            ? [Math.ceil(income.avgMonthlyCents / 2), Math.floor(income.avgMonthlyCents / 2)]
            : income.frequency === "monthly"
              ? [income.avgMonthlyCents]
              : [];
        for (const [i, amount] of parts.entries()) {
          await this.recurring.createInTx(
            tx,
            userId,
            {
              type: "income",
              accountId: primaryAccount,
              creditCardId: null,
              amountCents: amount,
              amountIsEstimate: true,
              categoryId: salary.id,
              description: parts.length > 1 ? `Renda (${i + 1}ª parcela)` : "Renda",
              frequency: "monthly",
              dayOfMonth: income.days[i]!,
              startDate: today,
              endDate: null,
            },
            "onboarding",
          );
        }
      }

      for (const goal of input.goals) {
        await this.goals.createInTx(tx, userId, goal, "onboarding");
      }

      const balances = input.accounts.map((a) => a.initialBalanceCents);
      const informedBalance = balances.some((b) => b !== null) ? balances.reduce<number>((s, b) => s + (b ?? 0), 0) : null;
      const incomeMonthly = income?.avgMonthlyCents ?? null;
      const missing: OnboardingSummary["missing"] = [];
      if (!incomeMonthly) missing.push("income");
      if (!input.accounts.length) missing.push("accounts");
      if (balances.length === 0 || balances.some((b) => b === null)) missing.push("balances");
      if (!input.fixedExpenses.length) missing.push("fixed");

      return {
        accountsCount: accountInputs.length,
        informedBalanceCents: informedBalance,
        cardsCount: input.cards.length,
        fixedExpensesMonthlyCents: fixedMonthly,
        incomeMonthlyCents: incomeMonthly,
        estimatedMonthlyLeftoverCents: incomeMonthly !== null ? incomeMonthly - fixedMonthly : null,
        goalsCount: input.goals.length,
        missing,
      };
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "onboarding.complete", requestId });
    return summary;
  }
}
