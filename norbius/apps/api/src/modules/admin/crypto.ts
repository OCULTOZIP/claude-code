import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Chave de 32 bytes (base64) de ADMIN_ENCRYPTION_KEY. */
export function loadKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("ADMIN_ENCRYPTION_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32).");
  return key;
}

/** AES-256-GCM: iv(12) | tag(16) | cifra, em base64. */
export function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

export function decrypt(key: Buffer, packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

/** Desafio curto entre a senha e o código TOTP: "adminId.exp.assinatura". */
export function signChallenge(key: Buffer, adminId: string, ttlMs = 5 * 60_000, now = Date.now()): string {
  const payload = `${adminId}.${now + ttlMs}`;
  return `${payload}.${createHmac("sha256", key).update(`challenge:${payload}`).digest("base64url")}`;
}

export function verifyChallenge(key: Buffer, token: string, now = Date.now()): string | null {
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig) return null;
  const expected = createHmac("sha256", key).update(`challenge:${id}.${exp}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b) || Number(exp) < now) return null;
  return id;
}
