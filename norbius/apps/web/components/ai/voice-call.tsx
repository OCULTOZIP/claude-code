"use client";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionCard, type Card } from "./action-card";
import { type OrbMode, VoiceOrb } from "./voice-orb";
import type { SpeechStream } from "./speech-stream";
import type { useVoice } from "./use-voice";

type Voice = ReturnType<typeof useVoice>;

export type VoiceAskHandlers = {
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  onCard: (card: Card) => void;
  onNotice: (message: string) => void;
};

type Phase = "listening" | "responding" | "paused";

/**
 * O Safari no Mac abaixa quase a zero o som da página enquanto o microfone
 * está aberto: lá, dá para interromper falando só enquanto o NORBIUS pensa;
 * durante a fala, o microfone fecha e a interrupção é pelo toque no núcleo.
 */
const MIC_DUCKS_AUDIO = typeof navigator !== "undefined" && /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const normalize = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Separa a fala do usuário do eco da voz do NORBIUS: palavras que não estão na
 * resposta dele são do usuário. `text` começa na primeira palavra nova.
 */
function userSpeech(heard: string, ownReply: string): { novel: number; text: string } {
  const own = new Set(ownReply.split(/\s+/).map(normalize).filter(Boolean));
  const words = heard.split(/\s+/).filter(Boolean);
  const isNew = (w: string) => {
    const n = normalize(w);
    return n.length > 1 && !own.has(n);
  };
  let first = words.findIndex(isNew);
  if (first < 0) return { novel: 0, text: "" };
  // Conectivos curtos logo antes ("e o cartão...") também são do usuário.
  while (first > 0 && normalize(words[first - 1]!).length <= 2) first--;
  return { novel: words.filter(isNew).length, text: words.slice(first).join(" ") };
}

/**
 * Modo ligação: ouve, responde falando e volta a ouvir, sem escrever nada na
 * tela. A resposta começa a ser falada na primeira frase (SpeechStream).
 * Cartões de confirmação (alterar, excluir, transferir) continuam aparecendo,
 * porque essas ações exigem um toque do usuário.
 */
export function VoiceCall({
  voice,
  ask,
  onClose,
}: {
  voice: Voice;
  ask: (text: string, handlers: VoiceAskHandlers) => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [message, setMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const open = useRef(true);
  const stream = useRef<SpeechStream | null>(null);
  /** Muda a cada interrupção: turnos antigos percebem e não retomam a escuta. */
  const turn = useRef(0);
  const silentRetries = useRef(0);
  const responding = useRef(false);
  const abort = useRef<AbortController | null>(null);
  /** Texto da resposta atual: o que o microfone ouvir igual a isso é eco do próprio NORBIUS. */
  const reply = useRef("");
  const speakingRef = useRef(false);
  speakingRef.current = voice.speaking;
  const micPausedForSpeech = () => MIC_DUCKS_AUDIO && speakingRef.current;

  /** Para a resposta em curso (fala, geração e streaming). */
  const interrupt = useCallback(() => {
    turn.current++;
    responding.current = false;
    abort.current?.abort();
    stream.current?.cancel();
    voice.stopSpeaking();
  }, [voice]);

  const listen = useCallback(() => {
    if (!open.current) return;
    setPhase("listening");
    voice.listen({
      silenceMs: 900,
      onInterim: () => {},
      onFinal: (text) => {
        if (!open.current) return;
        if (!text) {
          // Silêncio: continua ouvindo (algumas vezes), como numa ligação.
          if (silentRetries.current++ < 3) listen();
          else setPhase("paused");
          return;
        }
        silentRetries.current = 0;
        void respond(text);
      },
      onError: (msg, code) => {
        if (!open.current) return;
        if (code === "no-speech" && silentRetries.current++ < 3) {
          listen();
          return;
        }
        if (code !== "no-speech") setMessage(msg);
        setPhase("paused");
      },
    });
  }, [voice.listen]);

  /**
   * Enquanto o NORBIUS pensa ou fala, o microfone continua aberto. Se aparecerem
   * palavras que não são dele (eco), é o usuário falando por cima: ele se cala
   * na hora e essa mesma escuta vira a próxima pergunta.
   */
  const watchForBargeIn = useCallback(
    (id: number) => {
      if (!open.current || id !== turn.current || micPausedForSpeech()) return;
      let barged = false;
      let ownText = "";
      voice.listen({
        keepSpeaking: true,
        silenceMs: 900,
        onInterim: (heard) => {
          if (barged || id !== turn.current) return;
          if (userSpeech(heard, reply.current).novel >= 2) {
            barged = true;
            ownText = reply.current;
            interrupt();
            setPhase("listening");
          }
        },
        onFinal: (heard) => {
          if (!open.current) return;
          if (barged) {
            const text = userSpeech(heard, ownText).text;
            if (text) void respond(text);
            else listen();
            return;
          }
          // Só eco ou silêncio: se ainda está respondendo, continua vigiando.
          if (id === turn.current && responding.current && !micPausedForSpeech()) watchForBargeIn(id);
        },
        onError: (_msg, code) => {
          if (!open.current) return;
          if (barged) listen();
          else if (id === turn.current && responding.current && code !== "not-allowed" && !micPausedForSpeech()) {
            window.setTimeout(() => watchForBargeIn(id), 300);
          }
        },
      });
    },
    // respond é declarado abaixo e só é chamado depois, já definido.
    [interrupt, listen, voice.listen],
  );

  const respond = useCallback(
    async (text: string) => {
      const id = ++turn.current;
      setPhase("responding");
      setMessage(null);
      reply.current = "";
      responding.current = true;
      const controller = new AbortController();
      abort.current = controller;
      const s = voice.createStream();
      stream.current = s;
      watchForBargeIn(id);
      try {
        await ask(text, {
          signal: controller.signal,
          onDelta: (d) => {
            reply.current += d;
            s.push(d);
          },
          onCard: (c) => setCards((prev) => [...prev, c]),
          onNotice: (m) => setMessage(m),
        });
      } catch {
        if (!controller.signal.aborted) setMessage("A conexão caiu. Tente falar de novo.");
      }
      s.close();
      await s.finished;
      if (id !== turn.current) return; // interrompido: a escuta já assumiu
      responding.current = false;
      if (open.current) listen();
    },
    [ask, listen, voice, watchForBargeIn],
  );

  // Safari: fecha o microfone quando a voz começa, senão ela sai quase muda.
  useEffect(() => {
    if (voice.speaking && MIC_DUCKS_AUDIO && responding.current) {
      voice.abortListening();
    }
  }, [voice.speaking]);

  useEffect(() => {
    open.current = true;
    // Adiado um instante: em desenvolvimento o React monta, desmonta e remonta
    // o componente; sem isso, duas escutas brigariam pelo microfone.
    const timer = window.setTimeout(listen, 60);
    return () => {
      window.clearTimeout(timer);
      open.current = false;
      abort.current?.abort();
      stream.current?.cancel();
      voice.stopListening();
      voice.stopSpeaking();
    };
  }, []);

  /** Toque no núcleo: interrompe a fala e já passa a ouvir; ou retoma se estava pausado. */
  function tapCore() {
    voice.unlockAudio();
    if (phase === "listening") {
      voice.stopListening();
      return;
    }
    interrupt();
    silentRetries.current = 0;
    listen();
  }

  // Glitch e "falando" só com som saindo de verdade; preparar o áudio ainda é "pensando".
  const speaking = phase === "responding" && voice.audible;
  const orbMode: OrbMode = phase === "listening" ? "listening" : phase === "responding" ? (speaking ? "speaking" : "thinking") : "idle";
  // Voz do navegador (sem medidor de volume): simula a intensidade para o glitch não sumir.
  const level = () => (voice.audible ? voice.getLevel() || 0.25 + Math.random() * 0.35 : 0);
  const headline =
    phase === "listening"
      ? "Em que posso ajudar?"
      : phase === "responding"
        ? speaking
          ? ""
          : "Deixa eu ver…"
        : "Toque na esfera para falar";
  const hint =
    phase === "listening" ? "Ouvindo" : phase === "responding" ? (speaking ? "Toque na esfera para interromper" : "Pensando") : "Pausado";

  return (
    <div role="dialog" aria-label="Conversa por voz com o NORBIUS" className="fixed inset-0 z-50 bg-black">
      <div className="relative flex h-full flex-col items-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,rgba(229,9,20,0.16)_0%,rgba(229,9,20,0.04)_35%,#000_70%)]">
        <div className="absolute top-5 left-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg border border-primary/60 px-3 py-1.5 text-xs text-white/85 hover:border-primary hover:bg-primary/15 hover:text-white"
          >
            <X aria-hidden className="size-3.5" /> Encerrar
          </button>
        </div>
        <p className="absolute top-6 right-6 text-[11px] font-medium tracking-[0.35em] text-primary/80">NORBIUS</p>

        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
          <button
            type="button"
            onClick={tapCore}
            aria-label={hint}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <VoiceOrb mode={orbMode} getLevel={level} size={260} />
          </button>
        </div>

        <div className="flex w-full flex-col items-center gap-3 px-6 pb-10 sm:pb-14">
          <p aria-live="polite" className="min-h-9 text-center text-2xl font-light text-white/90 sm:text-[28px]">
            {headline}
          </p>
          <p className="flex items-center gap-2 text-xs tracking-wide text-white/45">
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${phase === "listening" ? "animate-pulse bg-primary-light" : speaking ? "bg-primary" : "bg-white/40"}`}
            />
            {hint}
          </p>
          {message ? <p className="max-w-sm text-center text-sm text-primary-light">{message}</p> : null}
          {cards.length ? (
            <div className="mt-2 flex w-full max-w-md flex-col gap-2">
              {cards.map((c, i) => (
                <ActionCard key={`${c.actionId ?? c.title}-${i}`} card={c} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
