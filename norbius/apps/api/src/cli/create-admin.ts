// Cria um administrador do painel (ADR 0007). Rode no seu terminal:
//   pnpm --filter @norbius/api admin:create --email voce@exemplo.com --name "Seu Nome" [--role superadmin]
// A senha é digitada sem aparecer; o QR code do autenticador aparece só aqui.
import { createDatabase, schema } from "@norbius/db";
import qrcode from "qrcode-terminal";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { passwordHasher } from "../lib/password";
import { encrypt, loadKey } from "../modules/admin/crypto";
import { newTotpSecret, otpauthUri, verifyTotp } from "../modules/admin/totp";

const ROLES = ["support", "billing", "analyst", "superadmin"] as const;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => write(s.startsWith(question) ? s : "");
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "superadmin" } } });
  const url = process.env.DATABASE_ADMIN_URL;
  const keyB64 = process.env.ADMIN_ENCRYPTION_KEY;
  if (!url || !keyB64) throw new Error("Configure DATABASE_ADMIN_URL e ADMIN_ENCRYPTION_KEY no .env antes de criar um admin.");
  const email = (values.email ?? (await ask("E-mail do administrador: "))).toLowerCase();
  const name = values.name ?? (await ask("Nome: "));
  const role = values.role as (typeof ROLES)[number];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
  if (!ROLES.includes(role)) throw new Error(`Papel inválido. Use: ${ROLES.join(", ")}.`);

  const password = await ask("Crie uma senha (mínimo 12 caracteres, não aparece na tela): ", true);
  if (password.length < 12) throw new Error("A senha precisa ter pelo menos 12 caracteres.");
  if ((await ask("Repita a senha: ", true)) !== password) throw new Error("As senhas não conferem.");

  const secret = newTotpSecret();
  console.log("\nEscaneie este QR code com o app autenticador do celular (Google Authenticator, Authy, 1Password...):\n");
  qrcode.generate(otpauthUri(secret, email), { small: true });
  console.log(`\nSe preferir digitar, use a chave: ${secret.match(/.{1,4}/g)!.join(" ")}\n`);
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    const code = await ask("Digite o código de 6 dígitos que apareceu no app: ");
    ok = verifyTotp(secret, code, 0) !== null;
    if (!ok) console.log("Código não confere. Confira se o relógio do celular está certo e tente de novo.");
  }
  if (!ok) throw new Error("Não foi possível confirmar o autenticador. Nada foi criado.");

  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await db.insert(schema.adminUsers).values({
      email,
      name,
      role,
      passwordHash: await passwordHasher.hash(password),
      totpSecret: encrypt(loadKey(keyB64), secret),
    });
    await db.insert(schema.auditLogs).values({ actorType: "system", action: "admin.admin.create", metadata: { email, role } });
  } finally {
    await close();
  }
  console.log(`\nAdministrador ${email} (${role}) criado. Entre no painel com e-mail, senha e o código do app.\n`);
}

main().catch((err) => {
  console.error(`\nErro: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
