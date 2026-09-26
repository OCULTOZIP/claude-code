// CPF/CNPJ: exigidos pelo meio de pagamento para gerar cobranças.
// O NORBIUS não guarda o documento — ele só é repassado ao provedor.

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const n = [...d].map(Number);
  const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  return checkDigit(n.slice(0, 9), w1) === n[9] && checkDigit(n.slice(0, 10), w2) === n[10];
}

export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const n = [...d].map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return checkDigit(n.slice(0, 12), w1) === n[12] && checkDigit(n.slice(0, 13), w2) === n[13];
}

export function isValidTaxId(value: string): boolean {
  return isValidCpf(value) || isValidCnpj(value);
}
