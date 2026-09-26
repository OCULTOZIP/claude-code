import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL, splitInstallments } from "../src";

describe("parseBRL", () => {
  it.each([
    ["50", 5000],
    ["50,5", 5050],
    ["50,05", 5005],
    ["R$ 1.234,56", 123456],
    ["1234,56", 123456],
    ["3.200", 320000],
    ["1.234.567", 123456700],
    ["1234.56", 123456],
    ["12.5", 1250],
    ["0,99", 99],
    ["-10,00", -1000],
  ])("%s → %i centavos", (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it.each(["", "abc", "1,234,56", "12,345", "1.23.4", "R$", "1e5"])("rejeita %s", (input) => {
    expect(parseBRL(input)).toBeNull();
  });
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(-5000)).toBe("-R$ 50,00");
  });
});

describe("splitInstallments", () => {
  it("divide e coloca o resto na primeira parcela", () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(120000, 10).every((v) => v === 12000)).toBe(true);
  });
  it("a soma sempre bate com o total", () => {
    for (const [total, n] of [[99999, 7], [1, 1], [100, 12], [123457, 48]] as const) {
      expect(splitInstallments(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it("rejeita entradas inválidas", () => {
    expect(() => splitInstallments(0, 1)).toThrow();
    expect(() => splitInstallments(100, 0)).toThrow();
    expect(() => splitInstallments(10.5, 2)).toThrow();
  });
});
