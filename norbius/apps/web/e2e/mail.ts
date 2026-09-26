import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { OUTBOX_DIR } from "../playwright.config";

type Email = { to: string; subject: string; text: string };

/** Espera o e-mail mais recente para `to` e devolve o primeiro link (caminho relativo). */
export async function latestLink(to: string, subject: RegExp): Promise<string> {
  let found: Email | undefined;
  await expect
    .poll(
      async () => {
        const files = (await readdir(OUTBOX_DIR).catch(() => [])).sort().reverse();
        for (const f of files) {
          const mail = JSON.parse(await readFile(join(OUTBOX_DIR, f), "utf8")) as Email;
          if (mail.to === to && subject.test(mail.subject)) {
            found = mail;
            return true;
          }
        }
        return false;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const url = new URL(found!.text.match(/https?:\/\/\S+/)![0]);
  return url.pathname + url.search;
}

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.norbius`;
}
