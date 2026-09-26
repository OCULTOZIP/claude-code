import type { Logger } from "@norbius/observability";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";

export type Email = { to: string; subject: string; html: string; text: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(email: Email) {
    const { error } = await this.client.emails.send({ from: this.from, ...email });
    if (error) throw new Error(`Falha ao enviar e-mail: ${error.message}`);
  }
}

/** Somente desenvolvimento: imprime o e-mail no log em vez de enviar. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: Logger) {}
  async send(email: Email) {
    this.log.warn({ mail: { subject: email.subject, text: email.text } }, "[dev] e-mail não enviado (sem RESEND_API_KEY)");
  }
}

/** Testes: guarda os e-mails em memória. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
  }
  lastTo(to: string) {
    return [...this.sent].reverse().find((e) => e.to === to);
  }
}

/** Somente dev/test (E2E): grava cada e-mail como JSON em um diretório. */
export class FileMailer implements Mailer {
  constructor(private readonly dir: string) {}
  async send(email: Email) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${Date.now()}-${crypto.randomUUID()}.json`), JSON.stringify(email));
  }
}
