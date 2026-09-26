import { describe, expect, it } from "vitest";
import { addDays, addMonths, afterQuietHours, diffDays, isIsoDate, localParts, monthRange, todayIn, zonedTime } from "../src";

describe("datas", () => {
  it("valida datas reais", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-1-1")).toBe(false);
  });

  it("soma meses limitando ao fim do mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
  });

  it("soma dias atravessando meses e anos", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffDays("2026-03-01", "2026-02-01")).toBe(28);
  });

  it("intervalo do mês", () => {
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("hoje no fuso do usuário", () => {
    // 02:30 UTC de 1º de março = 23:30 de 28/fev em São Paulo
    const now = new Date("2026-03-01T02:30:00Z");
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-02-28");
    expect(todayIn("UTC", now)).toBe("2026-03-01");
  });
});

describe("horário silencioso", () => {
  it("converte hora local e fuso", () => {
    expect(localParts(new Date("2026-09-26T01:30:00Z"), "America/Sao_Paulo")).toEqual({ date: "2026-09-25", hour: 22, minute: 30 });
    expect(zonedTime("2026-09-26", 8, "America/Sao_Paulo").toISOString()).toBe("2026-09-26T11:00:00.000Z");
    expect(zonedTime("2026-09-26", 8, "Asia/Tokyo").toISOString()).toBe("2026-09-25T23:00:00.000Z");
  });

  it("adia avisos entre 22h e 8h para as 8h", () => {
    const tz = "America/Sao_Paulo";
    const day = new Date("2026-09-26T15:00:00Z"); // 12h local
    expect(afterQuietHours(day, tz)).toBe(day);
    expect(afterQuietHours(new Date("2026-09-27T01:00:00Z"), tz).toISOString()).toBe("2026-09-27T11:00:00.000Z"); // 22h → 8h do dia seguinte
    expect(afterQuietHours(new Date("2026-09-27T06:00:00Z"), tz).toISOString()).toBe("2026-09-27T11:00:00.000Z"); // 3h → 8h do mesmo dia
  });
});
