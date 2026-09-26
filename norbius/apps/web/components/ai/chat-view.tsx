"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { TRIAL_DAYS } from "@norbius/domain";
import { Button, buttonClasses, cn, NorbiusCore } from "@norbius/ui";
import { ArrowUp, AudioLines, MessageSquarePlus, Mic, SlidersHorizontal, Square, Trash2, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionCard, type Card } from "./action-card";
import { useVoice } from "./use-voice";
import { VoiceCall, type VoiceAskHandlers } from "./voice-call";
import { VoicePanel } from "./voice-panel";

export type ChatItem = { role: "user" | "assistant"; text: string; cards: Card[] };

type ServerEvent =
  | { type: "conversation"; id: string; title: string | null }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "card"; card: Card }
  | { type: "notice"; message: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

const TOOL_LABEL: Record<string, string> = {
  get_financial_overview: "Consultando sua visão geral",
  search_transactions: "Buscando movimentações",
  get_spending_by_category: "Somando gastos por categoria",
  compare_periods: "Comparando períodos",
  list_upcoming_bills: "Verificando compromissos",
  get_credit_cards: "Consultando cartões",
  get_goals: "Consultando metas",
  create_transaction: "Registrando",
  create_card_purchase: "Registrando no cartão",
  create_goal: "Criando meta",
  add_goal_contribution: "Registrando aporte",
  remember: "Anotando",
  create_transfer: "Preparando transferência",
  update_transaction: "Preparando alteração",
  delete_transaction: "Preparando exclusão",
  create_recurring: "Preparando recorrência",
};

const SUGGESTIONS = [
  "Como está minha situação financeira?",
  "Quanto gastei com alimentação este mês?",
  "Quais são minhas próximas contas?",
  "Estou gastando mais que no mês passado?",
  "Gastei 50 reais no mercado.",
];

/** Lê um corpo SSE e entrega cada evento `data: {...}`. */
async function readEvents(res: Response, onEvent: (e: ServerEvent) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)) as ServerEvent);
    }
  }
}

export function ChatView({
  available,
  included,
  trialAvailable,
  usage,
  conversations,
  conversationId: initialId,
  initialItems,
  name,
}: {
  available: boolean;
  included: boolean;
  trialAvailable: boolean;
  usage: { used: number; limit: number };
  conversations: { id: string; title: string | null; lastMessageAt: string }[];
  conversationId: string | null;
  initialItems: ChatItem[];
  name: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>(initialItems);
  const [conversationId, setConversationId] = useState(initialId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [used, setUsed] = useState(usage.used);
  // Troca de conversa (links da lateral, "Nova conversa") reinicia a tela; o
  // refresh depois de uma resposta traz a mesma conversa e não apaga o que
  // está sendo digitado.
  const [syncedId, setSyncedId] = useState(initialId);
  if (initialId !== syncedId) {
    setSyncedId(initialId);
    if (initialId !== conversationId) {
      setConversationId(initialId);
      setItems(initialItems);
      setNotice(null);
    }
  }
  const bottom = useRef<HTMLDivElement>(null);
  const exhausted = used >= usage.limit;
  const voice = useVoice();
  // Ler respostas em voz alta: preferência do navegador; liga sozinha ao usar o microfone.
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [voicePanel, setVoicePanel] = useState(false);
  const [inCall, setInCall] = useState(false);
  // A ligação atravessa vários turnos: lê a conversa atual por ref, não pelo estado da renderização.
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  const voiceRepliesRef = useRef(false);
  voiceRepliesRef.current = voiceReplies;
  const replyText = useRef("");
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  useEffect(() => {
    try {
      setVoiceReplies(window.localStorage.getItem("norbius:voz") === "1");
    } catch {
      // armazenamento indisponível: fica desligado
    }
  }, []);

  function setVoicePref(on: boolean) {
    setVoiceReplies(on);
    if (!on) voice.stopSpeaking();
    try {
      window.localStorage.setItem("norbius:voz", on ? "1" : "0");
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  }

  function toggleMic() {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    setNotice(null);
    voice.unlockAudio();
    if (voice.canSpeak && !voiceRepliesRef.current) setVoicePref(true);
    voice.listen({
      silenceMs: 1200,
      onInterim: (t) => setInput(t),
      onFinal: (t) => {
        if (t) void sendRef.current(t);
      },
      onError: (msg) => setNotice(msg),
    });
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, activity]);

  function patchLast(fn: (item: ChatItem) => ChatItem) {
    setItems((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]!);
      return next;
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    voice.unlockAudio();
    setInput("");
    setNotice(null);
    setBusy(true);
    setActivity("Pensando");
    voice.stopSpeaking();
    replyText.current = "";
    setItems((prev) => [...prev, { role: "user", text: message, cards: [] }, { role: "assistant", text: "", cards: [] }]);
    try {
      const res = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
        credentials: "same-origin",
      });
      if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setItems((prev) => prev.slice(0, -1));
        setNotice(body?.error?.message ?? "Não foi possível falar com o NORBIUS agora.");
        return;
      }
      setUsed((u) => u + 1);
      await readEvents(res, (e) => {
        switch (e.type) {
          case "conversation":
            setConversationId(e.id);
            window.history.replaceState(null, "", `/norbius?c=${e.id}`);
            break;
          case "text":
            setActivity(null);
            replyText.current += e.delta;
            patchLast((it) => ({ ...it, text: it.text + e.delta }));
            break;
          case "tool":
            setActivity(TOOL_LABEL[e.name] ?? "Consultando");
            break;
          case "card":
            patchLast((it) => ({ ...it, cards: [...it.cards, e.card] }));
            break;
          case "notice":
          case "error":
            setNotice(e.message);
            break;
          case "done":
            break;
        }
      });
    } catch {
      setNotice("A conexão caiu. Sua mensagem pode ter sido registrada — atualize a página para conferir.");
    } finally {
      setBusy(false);
      setActivity(null);
      if (voiceRepliesRef.current && replyText.current.trim()) voice.speak(replyText.current);
      // Dados podem ter mudado (registros): atualiza o restante do app e a lista de conversas.
      router.refresh();
    }
  }

  sendRef.current = send;

  /** Turno falado da ligação: não entra na lista do chat; o texto vai direto para a voz. */
  async function askByVoice(message: string, h: VoiceAskHandlers) {
    const res = await fetch("/api/v1/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, voice: true, ...(conversationRef.current ? { conversationId: conversationRef.current } : {}) }),
      credentials: "same-origin",
      signal: h.signal,
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      h.onNotice(body?.error?.message ?? "Não foi possível falar com o NORBIUS agora.");
      return;
    }
    setUsed((u) => u + 1);
    await readEvents(res, (e) => {
      switch (e.type) {
        case "conversation":
          conversationRef.current = e.id;
          setConversationId(e.id);
          window.history.replaceState(null, "", `/norbius?c=${e.id}`);
          break;
        case "text":
          h.onDelta(e.delta);
          break;
        case "card":
          h.onCard(e.card);
          break;
        case "notice":
        case "error":
          h.onNotice(e.message);
          break;
        default:
          break;
      }
    });
  }

  function startCall() {
    voice.stopSpeaking();
    voice.unlockAudio();
    setVoicePanel(false);
    setNotice(null);
    setInCall(true);
  }

  if (!available) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
        <NorbiusCore state="ACTIVE" size={120} />
        <h1 className="mt-8 text-2xl font-semibold">O assistente NORBIUS ainda não está ativo</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
          O assistente conversacional não está configurado neste ambiente. Todo o resto do app funciona normalmente — registre e consulte
          suas finanças pelas telas de Transações, Contas, Cartões e Metas.
        </p>
      </div>
    );
  }

  if (!included) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
        <NorbiusCore state="ACTIVE" size={120} />
        <h1 className="mt-8 text-2xl font-semibold">O assistente NORBIUS faz parte do Pro</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
          Pergunte sobre suas finanças e registre gastos conversando.{" "}
          {trialAvailable ? `Teste por ${TRIAL_DAYS} dias sem cartão — nada é cobrado no fim.` : "Assine para continuar usando."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {trialAvailable ? (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/billing/trial", { method: "POST", json: {} });
                  router.refresh();
                } catch (err) {
                  setNotice(err instanceof ClientApiError ? err.message : "Não foi possível começar o teste.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Começar teste grátis
            </Button>
          ) : null}
          <Link href="/configuracoes/plano" className={buttonClasses({ variant: trialAvailable ? "secondary" : "primary" })}>
            Ver planos
          </Link>
        </div>
        {notice ? <p className="mt-4 text-sm text-primary-light">{notice}</p> : null}
      </div>
    );
  }

  const empty = items.length === 0;

  return (
    <>
      {inCall ? (
        <VoiceCall
          voice={voice}
          ask={askByVoice}
          onClose={() => {
            setInCall(false);
            router.refresh();
          }}
        />
      ) : null}
      <div className="-mb-12 grid h-[calc(100dvh-10.5rem)] gap-6 lg:h-[calc(100dvh-5rem)] lg:grid-cols-[240px_1fr]">
        <aside className="hidden min-h-0 flex-col gap-2 lg:flex">
          <Link
            href="/norbius"
            className="flex items-center gap-2 rounded-xl border border-line-strong px-3 py-2.5 text-sm hover:bg-secondary"
          >
            <MessageSquarePlus aria-hidden className="size-4" /> Nova conversa
          </Link>
          <nav aria-label="Conversas" className="mt-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {conversations.map((c) => (
              <div key={c.id} className="group flex items-center">
                <Link
                  href={`/norbius?c=${c.id}`}
                  aria-current={c.id === conversationId ? "page" : undefined}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-sm",
                    c.id === conversationId ? "bg-secondary text-fg" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  {c.title ?? "Conversa"}
                </Link>
                <button
                  type="button"
                  aria-label={`Arquivar ${c.title ?? "conversa"}`}
                  className="grid size-7 place-items-center rounded-md text-fg-muted opacity-0 group-hover:opacity-100 hover:text-primary-light focus:opacity-100"
                  onClick={async () => {
                    await api(`/ai/conversations/${c.id}/archive`, { method: "POST", json: {} });
                    if (c.id === conversationId) router.push("/norbius");
                    router.refresh();
                  }}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </div>
            ))}
          </nav>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 pb-3">
            <div className="flex items-center gap-3">
              <NorbiusCore state={busy ? "ANALYZING" : "ACTIVE"} size={36} />
              <div>
                <h1 className="text-sm font-semibold">NORBIUS</h1>
                <p className="text-xs text-fg-muted">
                  {used} de {usage.limit} mensagens este mês
                </p>
              </div>
            </div>
            <div className="relative flex items-center gap-2">
              {voice.canSpeak ? (
                <button
                  type="button"
                  aria-expanded={voicePanel}
                  aria-label="Configurar voz"
                  onClick={() => setVoicePanel((o) => !o)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                    voicePanel ? "bg-secondary text-fg" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  <SlidersHorizontal aria-hidden className="size-3.5" /> Voz
                </button>
              ) : null}
              {voicePanel && voice.canSpeak ? <VoicePanel voice={voice} onClose={() => setVoicePanel(false)} /> : null}
              {voice.canSpeak ? (
                <button
                  type="button"
                  aria-pressed={voiceReplies}
                  onClick={() => (voice.speaking ? voice.stopSpeaking() : setVoicePref(!voiceReplies))}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                    voiceReplies ? "bg-secondary text-fg" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  {voice.speaking ? (
                    <>
                      <Square aria-hidden className="size-3.5" /> Parar de falar
                    </>
                  ) : voiceReplies ? (
                    <>
                      <Volume2 aria-hidden className="size-3.5" /> Respostas em voz
                    </>
                  ) : (
                    <>
                      <VolumeX aria-hidden className="size-3.5" /> Voz desligada
                    </>
                  )}
                </button>
              ) : null}
              {!empty ? (
                <Link href="/norbius" className="text-xs text-fg-secondary hover:text-fg lg:hidden">
                  Nova conversa
                </Link>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <NorbiusCore state="ACTIVE" size={96} />
                <p className="mt-6 text-lg font-medium">Olá, {name}. Como posso ajudar?</p>
                <p className="mt-1 max-w-sm text-sm text-fg-secondary">
                  Pergunte sobre suas finanças ou registre um gasto em uma frase. Alterações e exclusões sempre pedem sua confirmação.
                </p>
                {voice.canListen ? (
                  <Button type="button" className="mt-6" disabled={exhausted} onClick={startCall}>
                    <AudioLines aria-hidden className="size-4" /> Conversar por voz
                  </Button>
                ) : null}
                <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy || exhausted}
                      onClick={() => send(s)}
                      className="rounded-full border border-line-strong px-3.5 py-1.5 text-sm text-fg-secondary hover:border-fg-muted hover:text-fg disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="flex flex-col gap-4 pb-4">
                {items.map((it, i) =>
                  it.role === "user" ? (
                    <li key={i} className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap">
                        {it.text}
                      </p>
                    </li>
                  ) : (
                    <li key={i} className="flex max-w-[92%] items-start gap-3">
                      <span aria-hidden className="mt-2.5 size-2 shrink-0 rounded-full bg-primary shadow-[0_0_10px_#E50914]" />
                      <div className="flex min-w-0 flex-col gap-2">
                        {it.cards.map((c, j) => (
                          <ActionCard key={`${c.actionId ?? c.title}-${j}`} card={c} />
                        ))}
                        {it.text ? <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{it.text}</p> : null}
                        {i === items.length - 1 && activity ? (
                          <p className="text-sm text-fg-muted">
                            {activity}
                            <span className="animate-pulse">…</span>
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ),
                )}
              </ol>
            )}
            <div ref={bottom} />
          </div>

          {notice ? (
            <p className="mb-2 rounded-xl border border-line-strong bg-secondary px-4 py-2.5 text-sm text-fg-secondary">{notice}</p>
          ) : null}

          <form
            method="post"
            className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 focus-within:border-fg-muted"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Mensagem para o NORBIUS
            </label>
            <textarea
              id="chat-input"
              rows={1}
              value={input}
              maxLength={2000}
              disabled={exhausted}
              placeholder={
                exhausted
                  ? "Limite de mensagens do mês atingido"
                  : voice.listening
                    ? "Ouvindo… pode falar"
                    : "Escreva ou fale com o NORBIUS…"
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
            />
            {voice.canListen ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Conversar por voz"
                title="Conversar por voz"
                disabled={busy || exhausted}
                onClick={startCall}
                className="size-10 p-0"
              >
                <AudioLines aria-hidden className="size-4" />
              </Button>
            ) : null}
            {voice.canListen ? (
              <Button
                type="button"
                size="sm"
                variant={voice.listening ? "primary" : "ghost"}
                aria-label={voice.listening ? "Parar de ouvir" : "Falar com o NORBIUS"}
                aria-pressed={voice.listening}
                disabled={(busy && !voice.listening) || exhausted}
                onClick={toggleMic}
                className={cn("size-10 p-0", voice.listening && "animate-pulse")}
              >
                <Mic aria-hidden className="size-4" />
              </Button>
            ) : null}
            <Button type="submit" size="sm" aria-label="Enviar" disabled={busy || !input.trim() || exhausted} className="size-10 p-0">
              <ArrowUp aria-hidden className="size-4" />
            </Button>
          </form>
          <p className="mt-2 text-center text-[11px] text-fg-muted">
            O NORBIUS usa seus dados registrados; estimativas são sempre sinalizadas. Não é consultoria financeira.
          </p>
        </section>
      </div>
    </>
  );
}
