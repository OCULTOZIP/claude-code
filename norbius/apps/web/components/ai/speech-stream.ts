/**
 * Fala uma resposta enquanto ela ainda chega do servidor: o texto em
 * streaming é cortado em frases, cada frase já começa a ser sintetizada ao
 * chegar e elas tocam em ordem. A primeira frase soa assim que termina, em
 * vez de esperar a resposta inteira.
 */

type Item = { text: string; audio: Promise<Blob> | null };

export type SpeechStreamDeps = {
  /** Limpa o trecho para leitura (marcação, pronúncia do nome). */
  clean: (text: string) => string;
  /** Começa a gerar o áudio neural do trecho (ou null para a voz do navegador). */
  prefetch: (text: string) => Promise<Blob> | null;
  /** Toca um trecho e resolve quando ele termina (ou é interrompido). */
  speakOne: (text: string, audio: Promise<Blob> | null) => Promise<void>;
};

// Fim de frase seguido de espaço, ou quebra de linha. "R$ 1.200" e "12:30" não cortam.
const SENTENCE_END = /[.!?…]+["')\]]*\s+|\n+/;
// Sem pontuação por muito tempo: corta na última vírgula/espaço para não travar a fala.
const MAX_PENDING = 220;

export class SpeechStream {
  private pending = "";
  private queue: Item[] = [];
  private closed = false;
  private cancelled = false;
  private running = false;
  private resolveFinished!: () => void;
  /** Resolve quando tudo foi falado (ou a fala foi cancelada). */
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });

  constructor(private readonly deps: SpeechStreamDeps) {}

  push(delta: string) {
    if (this.cancelled || this.closed) return;
    this.pending += delta;
    for (;;) {
      const m = SENTENCE_END.exec(this.pending);
      if (m) {
        const end = m.index + m[0].length;
        this.enqueue(this.pending.slice(0, end));
        this.pending = this.pending.slice(end);
        continue;
      }
      if (this.pending.length > MAX_PENDING) {
        const cut = Math.max(this.pending.lastIndexOf(", "), this.pending.lastIndexOf(" "));
        if (cut > 40) {
          this.enqueue(this.pending.slice(0, cut + 1));
          this.pending = this.pending.slice(cut + 1);
          continue;
        }
      }
      break;
    }
  }

  /** Fim da resposta: fala o que sobrou. */
  close() {
    if (this.closed) return;
    if (!this.cancelled) this.enqueue(this.pending);
    this.pending = "";
    this.closed = true;
    this.maybeFinish();
  }

  /** Interrompe: descarta o que falta. Quem chama também deve parar o áudio atual. */
  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.pending = "";
    this.maybeFinish();
  }

  private enqueue(raw: string) {
    const text = this.deps.clean(raw);
    if (!text) return;
    const audio = this.deps.prefetch(text);
    // Evita "unhandled rejection" se o trecho for descartado antes de tocar.
    audio?.catch(() => {});
    this.queue.push({ text, audio });
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.cancelled) {
      const item = this.queue.shift()!;
      try {
        await this.deps.speakOne(item.text, item.audio);
      } catch {
        // um trecho com falha não derruba o resto
      }
    }
    this.running = false;
    this.maybeFinish();
  }

  private maybeFinish() {
    if ((this.closed || this.cancelled) && !this.running && this.queue.length === 0) this.resolveFinished();
  }
}
