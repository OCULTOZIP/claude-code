import { describe, expect, it } from "vitest";
import { monthlyEquivalentCents, nextOccurrence, occurrencesBetween } from "../src";

describe("recorrências", () => {
  it("mensal no dia 31 respeita meses curtos e volta ao 31", () => {
    const rule = { frequency: "monthly" as const, startDate: "2026-01-31" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("usa dayOfMonth quando informado", () => {
    const rule = { frequency: "monthly" as const, startDate: "2026-09-26", dayOfMonth: 5 };
    expect(nextOccurrence(rule, "2026-09-26")).toBe("2026-10-05");
  });

  it("quinzenal e semanal", () => {
    expect(occurrencesBetween({ frequency: "biweekly", startDate: "2026-09-01" }, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-01",
      "2026-09-15",
      "2026-09-29",
    ]);
    expect(occurrencesBetween({ frequency: "weekly", startDate: "2026-09-25" }, "2026-09-26", "2026-10-09")).toEqual([
      "2026-10-02",
      "2026-10-09",
    ]);
  });

  it("anual em 29/fev", () => {
    expect(occurrencesBetween({ frequency: "yearly", startDate: "2028-02-29" }, "2028-01-01", "2030-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
    ]);
  });

  it("respeita a data final", () => {
    const rule = { frequency: "monthly" as const, startDate: "2026-01-10", endDate: "2026-03-10" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toHaveLength(3);
    expect(nextOccurrence(rule, "2026-03-11")).toBeNull();
  });

  it("equivalente mensal", () => {
    expect(monthlyEquivalentCents(1200, "yearly")).toBe(100);
    expect(monthlyEquivalentCents(1000, "weekly")).toBe(4333);
  });
});
