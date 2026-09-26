import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "../src";

describe("redaction", () => {
  it("remove senha, e-mail e valores dos logs", () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[redacted]" } }, stream);
    log.info({ body: { email: "ana@x.com", password: "segredo" }, tx: { amountCents: 5000 } }, "evento");
    const out = lines.join("");
    expect(out).not.toContain("ana@x.com");
    expect(out).not.toContain("segredo");
    expect(out).not.toContain("5000");
  });
});
