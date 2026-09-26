"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechStream } from "./speech-stream";

/**
 * Voz no navegador (Web Speech API): ditado em pt-BR e leitura das respostas.
 * Nada vai para servidores do NORBIUS além do texto já transcrito; o
 * reconhecimento em si é feito pelo navegador.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG = "pt-BR";

/** Tira marcação que soaria estranha lida em voz alta e acerta a pronúncia do nome. */
function cleanForSpeech(text: string): string {
  return (
    text
      // Pronúncia do nome: "Nórbius" (tônica na primeira sílaba), não "NorbiÚS" nem soletrado.
      .replace(/\bnorbius\b/gi, "Nórbius")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*_#`>|]/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Texto limpo quebrado em trechos de até ~200 caracteres (o Chrome corta falas longas). */
function toSpeechChunks(text: string): string[] {
  const clean = cleanForSpeech(text);
  const sentences = clean.match(/[^.!?…\n]+[.!?…]*/g) ?? [];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > 200 && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export type VoiceSettings = { voiceURI: string | null; pitch: number; rate: number };

const DEFAULT_SETTINGS: VoiceSettings = { voiceURI: null, pitch: 1, rate: 1 };
const SETTINGS_KEY = "norbius:voz-config";

function loadSettings(): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<VoiceSettings>) };
  } catch {
    // sem armazenamento ou valor inválido: usa o padrão
  }
  return DEFAULT_SETTINGS;
}

function portugueseVoices(): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis.getVoices();
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();
  const br = all.filter((v) => norm(v).startsWith("pt-br"));
  return br.length ? br : all.filter((v) => norm(v).startsWith("pt"));
}

/** Vozes neurais (Piper, servidas pela API) usam o prefixo "neural:" em `voiceURI`. */
export const NEURAL_PREFIX = "neural:";

async function fetchNeuralVoices(): Promise<string[]> {
  try {
    const res = await fetch("/api/v1/ai/voices", { credentials: "same-origin" });
    if (!res.ok) return [];
    return ((await res.json()) as { voices: string[] }).voices;
  } catch {
    return [];
  }
}

function fetchNeuralAudio(text: string, voice: string, speed: number): Promise<Blob> {
  return fetch("/api/v1/ai/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ text, voice, speed }),
  }).then((res) => {
    if (!res.ok) throw new Error(`tts ${res.status}`);
    return res.blob();
  });
}

function pickVoice(voiceURI: string | null): SpeechSynthesisVoice | null {
  const pt = portugueseVoices();
  if (voiceURI) {
    const chosen = pt.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  return pt.find((v) => /premium|enhanced|luciana|google/i.test(v.name)) ?? pt[0] ?? null;
}

export function useVoice() {
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /** Som saindo agora (não só preparando o áudio): é o que liga o glitch. */
  const [audible, setAudible] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [neuralVoices, setNeuralVoices] = useState<string[]>([]);
  const neuralRef = useRef<string[]>([]);
  neuralRef.current = neuralVoices;
  // Web Audio: depois de liberado num toque, toca a qualquer momento (o <audio> do Safari
  // é bloqueado quando o áudio chega segundos depois do toque).
  const audioCtx = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  /** Mede o volume da voz neural (anima o painel de voz). */
  const analyser = useRef<AnalyserNode | null>(null);
  const levelBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  /** Incrementado a cada fala nova ou parada: falas antigas percebem e desistem. */
  const playId = useRef(0);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setCanListen(recognitionCtor() !== null);
    const synth = typeof window !== "undefined" && "speechSynthesis" in window;
    setCanSpeak(synth);
    setSettings(loadSettings());
    void fetchNeuralVoices().then(setNeuralVoices);
    // Algumas vozes só carregam depois do primeiro getVoices() (evento voiceschanged).
    const refresh = () => setVoices(portugueseVoices());
    if (synth) {
      refresh();
      window.speechSynthesis.addEventListener("voiceschanged", refresh);
    }
    return () => {
      recognition.current?.abort();
      playId.current++;
      try {
        source.current?.stop();
      } catch {
        // já parado
      }
      void audioCtx.current?.close().catch(() => {});
      audioCtx.current = null;
      if (synth) {
        window.speechSynthesis.removeEventListener("voiceschanged", refresh);
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /** Voz efetiva: a escolhida, ou a primeira neural disponível, ou a melhor do navegador. */
  const resolveVoice = useCallback((voiceURI: string | null): string | null => {
    const neural = neuralRef.current;
    if (voiceURI?.startsWith(NEURAL_PREFIX)) {
      const name = voiceURI.slice(NEURAL_PREFIX.length);
      if (neural.includes(name)) return voiceURI;
    } else if (voiceURI && typeof window !== "undefined" && "speechSynthesis" in window && pickVoice(voiceURI)?.voiceURI === voiceURI) {
      return voiceURI;
    }
    if (neural.length) return NEURAL_PREFIX + (neural.includes("faber") ? "faber" : neural[0]);
    return typeof window !== "undefined" && "speechSynthesis" in window ? (pickVoice(null)?.voiceURI ?? null) : null;
  }, []);

  /** Chamar dentro de um clique/toque: libera o áudio neural (o Safari exige um gesto). */
  const unlockAudio = useCallback(() => {
    try {
      audioCtx.current ??= new AudioContext();
      if (audioCtx.current.state !== "running") void audioCtx.current.resume().catch(() => {});
    } catch {
      // sem Web Audio: fica a voz do navegador
    }
  }, []);

  /** Volume atual da voz neural, de 0 a 1 (0 quando nada toca). */
  const getLevel = useCallback(() => {
    const a = analyser.current;
    const buf = levelBuf.current;
    if (!a || !buf || !source.current) return 0;
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) * (v - 128);
    return Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 4);
  }, []);

  const stopSpeaking = useCallback(() => {
    playId.current++;
    try {
      source.current?.stop(); // dispara onended, que libera quem espera a fala
      setAudible(false);
    } catch {
      // já parado
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speakBrowser = useCallback((chunks: string[], voiceURI: string | null) => {
    if (!("speechSynthesis" in window)) {
      setSpeaking(false);
      return;
    }
    const synth = window.speechSynthesis;
    const { pitch, rate } = settingsRef.current;
    const voice = pickVoice(voiceURI?.startsWith(NEURAL_PREFIX) ? null : voiceURI);
    setSpeaking(true);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = LANG;
      u.pitch = pitch;
      u.rate = rate;
      if (voice) u.voice = voice;
      if (i === chunks.length - 1) {
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
      }
      synth.speak(u);
    });
  }, []);

  /** Toca um áudio pronto pelo Web Audio; resolve ao terminar ou ser interrompido. */
  const playBlob = useCallback(async (blob: Blob, id: number) => {
    const ctx = audioCtx.current;
    if (!ctx) throw new Error("audio bloqueado");
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    if (ctx.state !== "running") throw new Error("audio bloqueado");
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (id !== playId.current) return;
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (!analyser.current || analyser.current.context !== ctx) {
        analyser.current = ctx.createAnalyser();
        analyser.current.fftSize = 512;
        analyser.current.connect(ctx.destination);
        levelBuf.current = new Uint8Array(new ArrayBuffer(analyser.current.fftSize));
      }
      src.connect(analyser.current);
      src.onended = () => {
        if (source.current === src) source.current = null;
        setAudible(false);
        resolve();
      };
      source.current = src;
      setAudible(true);
      src.start();
    });
  }, []);

  /** Fala um trecho com a voz do navegador; resolve ao terminar ou ser cancelado. */
  const speakBrowserOne = useCallback((text: string, voiceURI: string | null) => {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    const { pitch, rate } = settingsRef.current;
    const voice = pickVoice(voiceURI?.startsWith(NEURAL_PREFIX) ? null : voiceURI);
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANG;
      u.pitch = pitch;
      u.rate = rate;
      if (voice) u.voice = voice;
      u.onstart = () => setAudible(true);
      u.onend = () => {
        setAudible(false);
        resolve();
      };
      u.onerror = () => {
        setAudible(false);
        resolve();
      };
      window.speechSynthesis.speak(u);
    });
  }, []);

  /**
   * Fala uma resposta que ainda está chegando (modo ligação): alimente com
   * `push(delta)`, feche com `close()` e aguarde `finished`.
   */
  const createStream = useCallback(() => {
    stopSpeaking();
    const id = playId.current;
    const voiceURI = resolveVoice(settingsRef.current.voiceURI);
    const neural = voiceURI?.startsWith(NEURAL_PREFIX) ? voiceURI.slice(NEURAL_PREFIX.length) : null;
    const speed = settingsRef.current.rate;
    const stream = new SpeechStream({
      clean: cleanForSpeech,
      prefetch: (text) => (neural ? fetchNeuralAudio(text, neural, speed) : null),
      speakOne: async (text, pending) => {
        if (id !== playId.current) return;
        setSpeaking(true);
        if (pending && neural) {
          // Mantém a mesma voz: se o trecho falhar, tenta gerar de novo antes de desistir.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const blob = await (attempt === 0 ? pending : fetchNeuralAudio(text, neural, speed));
              if (id !== playId.current) return;
              await playBlob(blob, id);
              return;
            } catch {
              if (id !== playId.current) return;
            }
          }
        }
        await speakBrowserOne(text, voiceURI);
      },
    });
    void stream.finished.then(() => {
      if (id === playId.current) setSpeaking(false);
    });
    return stream;
  }, [playBlob, resolveVoice, speakBrowserOne, stopSpeaking]);

  const speakNeural = useCallback(
    async (chunks: string[], voice: string) => {
      const id = ++playId.current;
      const speed = settingsRef.current.rate;
      setSpeaking(true);
      // Busca o trecho seguinte enquanto o atual toca.
      let next = fetchNeuralAudio(chunks[0]!, voice, speed);
      try {
        for (let i = 0; i < chunks.length; i++) {
          const blob = await next;
          if (id !== playId.current) return;
          if (i + 1 < chunks.length) {
            next = fetchNeuralAudio(chunks[i + 1]!, voice, speed);
            next.catch(() => {});
          }
          await playBlob(blob, id);
          if (id !== playId.current) return;
        }
        setSpeaking(false);
      } catch {
        // Serviço de voz fora do ar ou áudio bloqueado: cai para a voz do navegador.
        if (id === playId.current) speakBrowser(chunks, null);
      }
    },
    [playBlob, speakBrowser],
  );

  const speak = useCallback(
    (text: string) => {
      stopSpeaking();
      const chunks = toSpeechChunks(text);
      if (chunks.length === 0) return;
      const voiceURI = resolveVoice(settingsRef.current.voiceURI);
      if (voiceURI?.startsWith(NEURAL_PREFIX)) void speakNeural(chunks, voiceURI.slice(NEURAL_PREFIX.length));
      else speakBrowser(chunks, voiceURI);
    },
    [resolveVoice, speakBrowser, speakNeural, stopSpeaking],
  );

  /**
   * Começa a ouvir. `onInterim` recebe o texto parcial; `onFinal` o texto
   * final (vazio se nada foi entendido); `onError` uma mensagem para o usuário.
   */
  const listen = useCallback(
    (handlers: {
      onInterim: (t: string) => void;
      onFinal: (t: string) => void;
      onError: (msg: string, code?: string) => void;
      /** Encerra sozinho após este silêncio depois da fala (o Safari não encerra por conta própria). */
      silenceMs?: number;
      /** Ouve sem calar a fala atual (para o usuário poder interromper). */
      keepSpeaking?: boolean;
    }) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      if (!handlers.keepSpeaking) stopSpeaking();
      recognition.current?.abort();
      const r = new Ctor();
      r.lang = LANG;
      r.interimResults = true;
      r.continuous = false;
      let finalText = "";
      // O Safari às vezes encerra sem marcar o resultado como final: vale o último parcial.
      let lastHeard = "";
      let failed = false;
      let silenceTimer: number | undefined;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) finalText += res[0]!.transcript;
          else interim += res[0]!.transcript;
        }
        const heard = (finalText + interim).trim();
        if (heard !== lastHeard && handlers.silenceMs) {
          window.clearTimeout(silenceTimer);
          silenceTimer = window.setTimeout(() => {
            r.stop();
          }, handlers.silenceMs);
        }
        lastHeard = heard;
        handlers.onInterim(lastHeard);
      };
      r.onerror = (e) => {
        window.clearTimeout(silenceTimer);
        failed = true;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          handlers.onError("O navegador bloqueou o microfone. Permita o acesso ao microfone para este site e tente de novo.");
        } else if (e.error === "no-speech") {
          handlers.onError("Não ouvi nada. Toque no microfone e fale de novo.", e.error);
        } else if (e.error === "network") {
          handlers.onError("O reconhecimento de voz deste navegador precisa de internet. Verifique a conexão.");
        } else if (e.error !== "aborted") {
          handlers.onError("Não consegui usar o microfone agora. Tente de novo.");
        }
      };
      r.onend = () => {
        window.clearTimeout(silenceTimer);
        // Uma escuta antiga terminando não pode apagar a que começou depois dela.
        if (recognition.current === r) {
          recognition.current = null;
          setListening(false);
        }
        if (!failed) handlers.onFinal(finalText.trim() || lastHeard);
      };
      recognition.current = r;
      setListening(true);
      try {
        r.start();
      } catch {
        setListening(false);
        recognition.current = null;
        handlers.onError("Não consegui usar o microfone agora. Tente de novo.");
      }
    },
    [stopSpeaking],
  );

  const stopListening = useCallback(() => {
    recognition.current?.stop();
  }, []);

  /** Fecha o microfone na hora, descartando o que foi ouvido. */
  const abortListening = useCallback(() => {
    recognition.current?.abort();
  }, []);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // sem armazenamento: vale só nesta visita
      }
      return next;
    });
  }, []);

  const activeVoiceURI = canSpeak ? resolveVoice(settings.voiceURI) : null;

  return {
    canListen,
    canSpeak,
    listening,
    speaking,
    listen,
    stopListening,
    abortListening,
    getLevel,
    audible,
    speak,
    stopSpeaking,
    voices,
    neuralVoices,
    unlockAudio,
    createStream,
    settings,
    activeVoiceURI,
    updateSettings,
  };
}
