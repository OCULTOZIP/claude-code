import { hash, verify } from "@node-rs/argon2";

// Argon2id com parâmetros recomendados pela OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const passwordHasher = {
  hash: (password: string) => hash(password, OPTIONS),
  verify: ({ hash: digest, password }: { hash: string; password: string }) =>
    verify(digest, password).catch(() => false),
};
