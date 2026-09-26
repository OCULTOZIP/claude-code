"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { api } from "@/lib/client-api";
import { brl } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import type { OnboardingSummary } from "@norbius/contracts";
import { FREE_MAX_ACTIVE_GOALS } from "@norbius/domain";
import { Alert, Button, cn, Field, NorbiusCore, SelectField } from "@norbius/ui";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ACCOUNT_TYPES,
  emptyDraft,
  FIXED_CATEGORY_LABELS,
  FIXED_SUGGESTIONS,
  STEP_KEYS,
  toCompleteInput,
  type AccountDraft,
  type CardDraft,
  type Draft,
  type FixedDraft,
  type GoalDraft,
} from "./steps";

const FREQ_LABEL = { monthly: "Mensal", biweekly: "Quinzenal", weekly: "Semanal", irregular: "Variável" } as const;

function restore(draft: Record<string, unknown> | null, name: string): Draft {
  if (draft && typeof draft.step === "number") return { ...emptyDraft(name), ...(draft as Partial<Draft>) } as Draft;
  return emptyDraft(name);
}

export function OnboardingChat({ initialName, draft }: { initialName: string; draft: Record<string, unknown> | null }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(() => restore(draft, initialName));
  const [summary, setSummary] = useState<OnboardingSummary | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [d.step, summary]);

  async function persist(next: Draft) {
    const key = STEP_KEYS[Math.min(next.step, STEP_KEYS.length - 1)]!;
    // Rascunho é conveniência: falha ao salvar não bloqueia o fluxo.
    await api("/onboarding/draft", { method: "PUT", json: { step: key, data: next } }).catch(() => undefined);
  }

  function advance(patch: Partial<Draft>) {
    const next = { ...d, ...patch, step: d.step + 1 };
    setD(next);
    if (next.step < STEP_KEYS.length) void persist(next);
    else void complete(next);
  }

  async function complete(final: Draft) {
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await api<OnboardingSummary>("/onboarding/complete", { method: "POST", json: toCompleteInput(final) }));
    } catch {
      setError("Não consegui concluir agora. Seus dados continuam aqui — tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function skipAll() {
    setBusy(true);
    await api("/onboarding/skip", { method: "POST", json: {} }).catch(() => undefined);
    router.replace("/dashboard");
    router.refresh();
  }

  const questions = [
    "Olá. Eu sou o NORBIUS, sua inteligência financeira. Vou fazer algumas perguntas rápidas — você pode pular qualquer uma. Como prefere ser chamado?",
    `Prazer, ${d.name}. Em média, quanto entra por mês?`,
    "E como você costuma receber?",
    "Onde fica o seu dinheiro hoje? Adicione suas contas.",
    "Você usa cartão de crédito?",
    "Quais contas se repetem todo mês?",
    "Tem algo que você quer conquistar?",
    d.accounts.length
      ? "Por último: quanto você tem hoje em cada conta?"
      : "Como você não adicionou contas, vou criar uma Carteira com saldo zero para começar.",
  ];

  const answers = [
    d.name,
    d.incomeCents ? brl(d.incomeCents) : "Prefiro não dizer",
    d.frequency
      ? `${FREQ_LABEL[d.frequency]}${d.days.length ? ` · dia${d.days.length > 1 ? "s" : ""} ${d.days.join(" e ")}` : ""}`
      : "Pular",
    d.accounts.length ? d.accounts.map((a) => a.name).join(", ") : "Pular",
    d.cards.length ? d.cards.map((c) => c.name).join(", ") : "Não uso",
    d.fixed.length ? `${d.fixed.length} conta${d.fixed.length > 1 ? "s" : ""} · ${brl(d.fixed.reduce((s, f) => s + f.amountCents, 0))}/mês` : "Nenhuma por agora",
    d.goals.length ? d.goals.map((g) => g.name).join(", ") : "Por enquanto não",
    d.accounts.length
      ? d.balances.some((b) => b !== null)
        ? `Total informado: ${brl(d.balances.reduce<number>((s, b) => s + (b ?? 0), 0))}`
        : "Prefiro não informar"
      : "Ok",
  ];

  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NorbiusCore state={busy ? "ANALYZING" : "ACTIVE"} size={44} />
          <div>
            <p className="text-sm font-medium">Primeiros passos</p>
            <p className="text-xs text-fg-muted">
              {summary ? "Concluído" : `Etapa ${Math.min(d.step + 1, STEP_KEYS.length)} de ${STEP_KEYS.length}`}
            </p>
          </div>
        </div>
        {!summary ? (
          <Button variant="ghost" size="sm" onClick={skipAll} disabled={busy}>
            Pular configuração
          </Button>
        ) : null}
      </div>

      <ol className="flex flex-col gap-4" aria-live="polite">
        {questions.slice(0, Math.min(d.step, STEP_KEYS.length)).map((q, i) => (
          <li key={i} className="flex flex-col gap-3">
            <Bot>{q}</Bot>
            <Me onEdit={!summary && !busy ? () => setD({ ...d, step: i }) : undefined}>{answers[i]}</Me>
          </li>
        ))}
        {d.step < STEP_KEYS.length ? (
          <li className="flex flex-col gap-3">
            <Bot>{questions[d.step]}</Bot>
            <Panel>
              <StepInput d={d} onNext={advance} />
            </Panel>
          </li>
        ) : null}
        {busy && !summary ? <Bot>Configurando seu ambiente…</Bot> : null}
        {error ? (
          <li className="flex flex-col gap-3">
            <Alert tone="error">{error}</Alert>
            <div>
              <Button onClick={() => complete(d)}>Tentar novamente</Button>
            </div>
          </li>
        ) : null}
        {summary ? <SummaryMessage summary={summary} onOpen={() => { router.replace("/dashboard"); router.refresh(); }} /> : null}
      </ol>
      <div ref={bottom} />
    </div>
  );
}

function Bot({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-[92%] animate-fade-up items-start gap-3">
      <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary shadow-[0_0_10px_#E50914]" />
      <p className="rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 text-[15px] leading-relaxed">{children}</p>
    </div>
  );
}

function Me({ children, onEdit }: { children: ReactNode; onEdit?: (() => void) | undefined }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-center gap-3">
        {onEdit ? (
          <button type="button" onClick={onEdit} className="text-xs text-fg-muted hover:text-fg">
            Editar
          </button>
        ) : null}
        <p className="rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm">{children}</p>
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="animate-fade-up rounded-card border border-line-strong bg-surface p-5">{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>;
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active ? "border-primary bg-primary/15 text-fg" : "border-line-strong text-fg-secondary hover:border-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function dayNumber(v: FormDataEntryValue | null) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

function StepInput({ d, onNext }: { d: Draft; onNext: (patch: Partial<Draft>) => void }) {
  const hydrated = useHydrated();
  switch (d.step) {
    case 0:
      return (
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name) onNext({ name: name.slice(0, 80) });
          }}
        >
          <Field label="Seu nome" name="name" defaultValue={d.name} autoComplete="given-name" maxLength={80} required autoFocus />
          <Actions>
            <Button type="submit" disabled={!hydrated}>Continuar</Button>
          </Actions>
        </form>
      );
    case 1:
      return <IncomeStep d={d} onNext={onNext} />;
    case 2:
      return <FrequencyStep d={d} onNext={onNext} />;
    case 3:
      return <AccountsStep d={d} onNext={onNext} />;
    case 4:
      return <CardsStep d={d} onNext={onNext} />;
    case 5:
      return <FixedStep d={d} onNext={onNext} />;
    case 6:
      return <GoalsStep d={d} onNext={onNext} />;
    default:
      return <BalancesStep d={d} onNext={onNext} />;
  }
}

function IncomeStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const hydrated = useHydrated();
  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = centsFrom(new FormData(e.currentTarget), "income");
        if (cents && cents > 0) onNext({ incomeCents: cents });
      }}
    >
      <MoneyField label="Renda média mensal (R$)" name="income" defaultCents={d.incomeCents} autoFocus hint="Um valor aproximado já ajuda." />
      <Actions>
        <Button type="submit" disabled={!hydrated}>Continuar</Button>
        <Button variant="ghost" onClick={() => onNext({ incomeCents: null })}>
          Prefiro não dizer
        </Button>
      </Actions>
    </form>
  );
}

function FrequencyStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const [freq, setFreq] = useState(d.frequency);
  const [days, setDays] = useState<string[]>(d.days.map(String));
  const [createRecurring, setCreateRecurring] = useState(d.createRecurring);
  const needsDays = freq === "monthly" ? 1 : freq === "biweekly" ? 2 : 0;
  const parsed = days.slice(0, needsDays).map((x) => dayNumber(x));
  const valid = freq !== null && parsed.length === needsDays && parsed.every((x) => x !== null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FREQ_LABEL) as (keyof typeof FREQ_LABEL)[]).map((f) => (
          <Chip key={f} active={freq === f} onClick={() => setFreq(f)}>
            {FREQ_LABEL[f]}
          </Chip>
        ))}
      </div>
      {needsDays > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {Array.from({ length: needsDays }, (_, i) => (
            <Field
              key={i}
              label={needsDays > 1 ? `${i + 1}º dia de recebimento` : "Dia do recebimento"}
              inputMode="numeric"
              value={days[i] ?? ""}
              onChange={(e) => setDays((prev) => Object.assign([...prev], { [i]: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
              placeholder="5"
            />
          ))}
        </div>
      ) : null}
      {needsDays > 0 && d.incomeCents ? (
        <label className="mt-4 flex items-start gap-3 text-sm text-fg-secondary">
          <input type="checkbox" checked={createRecurring} onChange={(e) => setCreateRecurring(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
          Registrar essa renda como receita prevista (marcada como estimativa).
        </label>
      ) : null}
      {freq === "weekly" || freq === "irregular" ? (
        <p className="mt-4 text-sm text-fg-muted">Sem problema. Vou considerar sua renda conforme você registrar os recebimentos.</p>
      ) : null}
      <Actions>
        <Button disabled={!valid} onClick={() => onNext({ frequency: freq, days: parsed as number[], createRecurring })}>
          Continuar
        </Button>
        <Button variant="ghost" onClick={() => onNext({ frequency: null, days: [] })}>
          Pular
        </Button>
      </Actions>
    </div>
  );
}

function ListRows<T>({ items, render, onRemove }: { items: T[]; render: (item: T) => ReactNode; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <ul className="mb-5 divide-y divide-line rounded-xl border border-line">
      {items.map((item, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 truncate">{render(item)}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label="Remover" className="text-fg-muted hover:text-primary-light">
            <Trash2 aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AccountsStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const [items, setItems] = useState<AccountDraft[]>(d.accounts);
  const [type, setType] = useState<AccountDraft["type"]>("checking");
  const [name, setName] = useState("");
  const add = () => {
    if (!name.trim()) return;
    setItems([...items, { name: name.trim().slice(0, 60), type }]);
    setName("");
  };
  return (
    <div>
      <ListRows items={items} render={(a) => `${a.name} · ${ACCOUNT_TYPES.find((t) => t.value === a.type)!.label}`} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap gap-2">
        {ACCOUNT_TYPES.map((t) => (
          <Chip key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
            {t.label}
          </Chip>
        ))}
      </div>
      <div className="mt-4 flex items-end gap-2">
        <Field
          className="flex-1"
          label="Nome da conta"
          placeholder="Ex.: Nubank, Itaú, Carteira"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} aria-label="Adicionar conta" disabled={!name.trim() || items.length >= 10}>
          <Plus aria-hidden className="size-4" /> Adicionar
        </Button>
      </div>
      <Actions>
        <Button disabled={!items.length} onClick={() => onNext({ accounts: items, balances: items.map((_, i) => d.balances[i] ?? null) })}>
          Continuar
        </Button>
        <Button variant="ghost" onClick={() => onNext({ accounts: [], balances: [] })}>
          Pular
        </Button>
      </Actions>
    </div>
  );
}

function CardsStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const [items, setItems] = useState<CardDraft[]>(d.cards);
  const [adding, setAdding] = useState(d.cards.length > 0);
  const [error, setError] = useState<string>();
  if (!adding) {
    return (
      <Actions>
        <Button onClick={() => setAdding(true)}>Sim, uso</Button>
        <Button variant="ghost" onClick={() => onNext({ cards: [] })}>
          Não uso
        </Button>
      </Actions>
    );
  }
  return (
    <div>
      <ListRows items={items} render={(c) => `${c.name} · limite ${brl(c.limitCents)} · fecha dia ${c.closingDay}, vence dia ${c.dueDay}`} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const name = String(f.get("name") ?? "").trim();
          const limitCents = centsFrom(f, "limit");
          const closingDay = dayNumber(f.get("closing"));
          const dueDay = dayNumber(f.get("due"));
          if (!name || limitCents === undefined || !closingDay || !dueDay) {
            setError("Preencha nome, limite e os dias de fechamento e vencimento (1 a 31).");
            return;
          }
          setError(undefined);
          setItems([...items, { name: name.slice(0, 60), limitCents, closingDay, dueDay }]);
          e.currentTarget.reset();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Field label="Nome do cartão" name="name" placeholder="Ex.: Nubank" maxLength={60} />
        <MoneyField label="Limite (R$)" name="limit" key={items.length} />
        <Field label="Dia do fechamento" name="closing" inputMode="numeric" placeholder="3" />
        <Field label="Dia do vencimento" name="due" inputMode="numeric" placeholder="10" />
        {error ? <p className="text-xs text-primary-light sm:col-span-2">{error}</p> : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={items.length >= FREE_MAX_ACTIVE_GOALS}>
            <Plus aria-hidden className="size-4" /> Adicionar cartão
          </Button>
        </div>
      </form>
      <Actions>
        <Button disabled={!items.length} onClick={() => onNext({ cards: items })}>
          Continuar
        </Button>
        <Button variant="ghost" onClick={() => onNext({ cards: [] })}>
          Pular
        </Button>
      </Actions>
    </div>
  );
}

function FixedStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const [items, setItems] = useState<FixedDraft[]>(d.fixed);
  const [picked, setPicked] = useState<{ description: string; categoryKey: string } | null>(null);
  const [error, setError] = useState<string>();
  return (
    <div>
      <ListRows items={items} render={(f) => `${f.description} · ${brl(f.amountCents)} · dia ${f.dayOfMonth}`} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap gap-2">
        {FIXED_SUGGESTIONS.map((s) => (
          <Chip key={s.description} active={picked?.description === s.description} onClick={() => setPicked(s)}>
            {s.description}
          </Chip>
        ))}
      </div>
      {picked ? (
        <form
          method="post"
          key={picked.description + items.length}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const description = String(f.get("description") ?? "").trim();
            const amountCents = centsFrom(f, "amount");
            const dayOfMonth = dayNumber(f.get("day"));
            if (!description || !amountCents || !dayOfMonth) {
              setError("Informe descrição, valor e o dia do vencimento (1 a 31).");
              return;
            }
            setError(undefined);
            setItems([...items, { description: description.slice(0, 140), amountCents, dayOfMonth, categoryKey: String(f.get("category")) }]);
            setPicked(null);
          }}
          className="mt-5 grid gap-3 sm:grid-cols-2"
        >
          <Field label="Descrição" name="description" defaultValue={picked.description} maxLength={140} />
          <SelectField
            label="Categoria"
            name="category"
            defaultValue={picked.categoryKey}
            options={Object.entries(FIXED_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <MoneyField label="Valor (R$)" name="amount" autoFocus />
          <Field label="Dia do vencimento" name="day" inputMode="numeric" placeholder="10" />
          {error ? <p className="text-xs text-primary-light sm:col-span-2">{error}</p> : null}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary">
              <Plus aria-hidden className="size-4" /> Adicionar
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-xs text-fg-muted">Toque em uma sugestão para adicionar. Você pode editar a descrição.</p>
      )}
      <Actions>
        <Button disabled={!items.length} onClick={() => onNext({ fixed: items })}>
          Continuar
        </Button>
        <Button variant="ghost" onClick={() => onNext({ fixed: [] })}>
          Nenhuma por agora
        </Button>
      </Actions>
    </div>
  );
}

function GoalsStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const [items, setItems] = useState<GoalDraft[]>(d.goals);
  const [error, setError] = useState<string>();
  return (
    <div>
      <ListRows items={items} render={(g) => `${g.name} · ${brl(g.targetAmountCents)}${g.targetDate ? ` até ${g.targetDate.split("-").reverse().join("/")}` : ""}`} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const name = String(f.get("name") ?? "").trim();
          const targetAmountCents = centsFrom(f, "target");
          const date = String(f.get("date") ?? "");
          if (!name || !targetAmountCents) {
            setError("Informe o nome e o valor da meta.");
            return;
          }
          setError(undefined);
          setItems([...items, { name: name.slice(0, 60), targetAmountCents, targetDate: date || null }]);
          e.currentTarget.reset();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Field label="Meta" name="name" placeholder="Ex.: Reserva de emergência" maxLength={60} />
        <MoneyField label="Valor (R$)" name="target" key={items.length} />
        <Field label="Prazo (opcional)" name="date" type="date" />
        {error ? <p className="text-xs text-primary-light sm:col-span-2">{error}</p> : null}
        <div className="flex items-end sm:col-span-1">
          <Button type="submit" variant="secondary" disabled={items.length >= FREE_MAX_ACTIVE_GOALS}>
            <Plus aria-hidden className="size-4" /> Adicionar meta
          </Button>
        </div>
      </form>
      <Actions>
        <Button disabled={!items.length} onClick={() => onNext({ goals: items })}>
          Continuar
        </Button>
        <Button variant="ghost" onClick={() => onNext({ goals: [] })}>
          Por enquanto não
        </Button>
      </Actions>
    </div>
  );
}

function BalancesStep({ d, onNext }: { d: Draft; onNext: (p: Partial<Draft>) => void }) {
  const hydrated = useHydrated();
  if (!d.accounts.length) {
    return (
      <Actions>
        <Button onClick={() => onNext({})}>Concluir</Button>
      </Actions>
    );
  }
  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onNext({ balances: d.accounts.map((_, i) => centsFrom(f, `b${i}`) ?? null) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {d.accounts.map((a, i) => (
          <MoneyField key={i} label={`${a.name} (R$)`} name={`b${i}`} defaultCents={d.balances[i]} allowNegative />
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-muted">Deixe em branco o que não quiser informar agora.</p>
      <Actions>
        <Button type="submit" disabled={!hydrated}>Concluir</Button>
        <Button variant="ghost" onClick={() => onNext({ balances: d.accounts.map(() => null) })}>
          Prefiro não informar
        </Button>
      </Actions>
    </form>
  );
}

const MISSING_LABEL = {
  income: "sua renda",
  accounts: "suas contas",
  balances: "o saldo atual de todas as contas",
  fixed: "suas despesas fixas",
} as const;

function SummaryMessage({ summary: s, onOpen }: { summary: OnboardingSummary; onOpen: () => void }) {
  const lines: string[] = [];
  lines.push(
    `Você tem ${s.accountsCount} ${s.accountsCount === 1 ? "conta" : "contas"}${s.informedBalanceCents !== null ? `, somando ${brl(s.informedBalanceCents)} (informado por você)` : ""}${s.cardsCount ? ` e ${s.cardsCount} ${s.cardsCount === 1 ? "cartão" : "cartões"}` : ""}.`,
  );
  if (s.fixedExpensesMonthlyCents) lines.push(`Suas despesas fixas somam ${brl(s.fixedExpensesMonthlyCents)} por mês.`);
  if (s.incomeMonthlyCents !== null && s.estimatedMonthlyLeftoverCents !== null) {
    lines.push(
      `Com renda média de ${brl(s.incomeMonthlyCents)}, sobram cerca de ${brl(s.estimatedMonthlyLeftoverCents)} por mês depois das contas fixas. É uma estimativa — ela fica mais precisa conforme você registra seus gastos.`,
    );
  }
  if (s.goalsCount) lines.push(`${s.goalsCount === 1 ? "Criei 1 meta" : `Criei ${s.goalsCount} metas`} para você acompanhar.`);
  if (s.missing.length) lines.push(`Ainda não sei ${s.missing.map((m) => MISSING_LABEL[m]).join(", ")}. Você pode informar quando quiser.`);
  return (
    <li className="flex flex-col gap-3">
      <Bot>
        <span className="block font-medium">Seu ambiente está pronto.</span>
        {lines.map((l) => (
          <span key={l} className="mt-2 block text-fg-secondary">
            {l}
          </span>
        ))}
      </Bot>
      <div className="pl-5">
        <Button onClick={onOpen}>Abrir meu painel</Button>
      </div>
    </li>
  );
}
