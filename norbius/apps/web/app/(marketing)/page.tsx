import { DemoChat } from "@/components/marketing/demo-chat";
import { DemoDashboard } from "@/components/marketing/demo-dashboard";
import { FaqList } from "@/components/marketing/faq-list";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section } from "@/components/marketing/section";
import { FEATURES, PRINCIPLES, SECURITY, STEPS } from "@/lib/content";
import { Badge, buttonClasses, NorbiusCore } from "@norbius/ui";
import { ArrowRight, Lock, ShieldCheck, Sparkles, Waypoints } from "lucide-react";
import Link from "next/link";

const PROBLEMS = [
  "Planilhas que ninguém atualiza depois da segunda semana.",
  "Aplicativos que mostram gráficos, mas não respondem perguntas simples.",
  "Surpresas no fim do mês: a fatura, a conta anual, o gasto que passou despercebido.",
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-64 mx-auto h-[36rem] max-w-4xl rounded-full bg-primary/12 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-20 pb-24 sm:px-6 sm:pt-28 lg:grid-cols-[1.25fr_1fr]">
          <div className="animate-fade-up">
            <Badge tone="primary">Acesso antecipado</Badge>
            <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
              Seu dinheiro.
              <br />
              <span className="text-fg-secondary">Uma inteligência trabalhando por você.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary text-pretty">
              Conheça o NORBIUS, seu sistema de inteligência financeira pessoal.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/cadastro" className={buttonClasses({ size: "lg" })}>
                Começar agora <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="#como-funciona" className={buttonClasses({ size: "lg", variant: "secondary" })}>
                Conhecer o NORBIUS
              </Link>
            </div>
            <p className="mt-6 text-xs text-fg-muted">
              Lançamento em etapas: os recursos são liberados conforme ficam prontos.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              <NorbiusCore state="ACTIVE" size={300} />
              <p className="absolute inset-x-0 -bottom-6 text-center font-mono text-[11px] tracking-[0.3em] text-fg-muted">
                NORBIUS CORE
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Problema */}
      <Section
        eyebrow="O problema"
        title="Controlar dinheiro não deveria ser um segundo emprego."
        className="border-t border-line"
      >
        <ul className="grid gap-4 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <li key={p} className="rounded-card border border-line bg-card p-6 text-fg-secondary leading-relaxed">
              {p}
            </li>
          ))}
        </ul>
      </Section>

      {/* Solução */}
      <Section
        eyebrow="A solução"
        title="Um centro de comando para a sua vida financeira."
        description="O NORBIUS reúne seus registros, entende seus padrões e responde em linguagem natural. Tudo com base nos seus dados — e deixando claro o que é fato e o que é estimativa."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Waypoints, title: "Organiza", text: "Contas, cartões, metas e compromissos em um só lugar." },
            { icon: Sparkles, title: "Entende", text: "Detecta padrões, recorrências e gastos fora do comum." },
            { icon: ShieldCheck, title: "Antecipa", text: "Projeta o saldo e avisa antes do problema chegar." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-card border border-line bg-card p-6">
              <Icon aria-hidden className="size-5 text-primary" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Como funciona */}
      <Section id="como-funciona" eyebrow="Como funciona" title="Três passos. Nenhuma planilha.">
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-card border border-line bg-card p-6">
              <span className="font-mono text-sm text-primary-light">{s.n}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.description}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Assistente */}
      <Section
        eyebrow="Assistente NORBIUS"
        title="Pergunte como perguntaria a um assessor."
        description="Registre um gasto numa frase, pergunte quanto pode gastar na semana ou se está gastando mais que no mês passado. O NORBIUS responde com os seus números e pede confirmação antes de alterar qualquer dado."
      >
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <DemoChat />
          <ul className="flex flex-col gap-3">
            {[
              "Quanto posso gastar essa semana?",
              "Quanto gastei com alimentação?",
              "Estou gastando mais que no mês passado?",
              "Quais são minhas próximas contas?",
              "Crie uma meta de 5.000 reais.",
            ].map((q) => (
              <li key={q} className="rounded-xl border border-line bg-card px-4 py-3 text-sm text-fg-secondary">
                “{q}”
              </li>
            ))}
            <li className="px-1 pt-2 text-xs text-fg-muted">Incluído no plano Pro · teste 7 dias grátis, sem cartão.</li>
          </ul>
        </div>
      </Section>

      {/* Dashboard */}
      <Section
        eyebrow="Dashboard"
        title="Tudo que importa, em uma tela."
        description="Saldo, fluxo, categorias, compromissos e metas — com o NORBIUS CORE indicando o estado real da sua vida financeira."
      >
        <DemoDashboard />
      </Section>

      {/* Recursos */}
      <Section id="recursos" eyebrow="Recursos" title="Construído em etapas, com transparência.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col rounded-card border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{f.title}</h3>
                {f.availability === "available" ? <Badge tone="success">Disponível</Badge> : <Badge>Em breve</Badge>}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{f.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Inteligência financeira */}
      <Section
        eyebrow="Inteligência financeira"
        title="Inteligência que você pode auditar."
        description="O NORBIUS foi desenhado para nunca inventar números. Cada resposta se apoia em dados reais e cada estimativa mostra de onde veio."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="rounded-card border border-line bg-card p-6">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{p.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Segurança */}
      <Section eyebrow="Segurança" title="Segurança é fundação, não recurso.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map((s) => (
            <div key={s.title} className="rounded-card border border-line bg-card p-6">
              <Lock aria-hidden className="size-4 text-primary" />
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Preços */}
      <Section id="precos" eyebrow="Preços" title="Comece grátis.">
        <PricingCards />
      </Section>

      {/* FAQ */}
      <Section eyebrow="FAQ" title="Perguntas frequentes">
        <FaqList limit={5} />
        <Link href="/faq" className="mt-6 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg">
          Ver todas as perguntas <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Section>

      {/* CTA final */}
      <section className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <NorbiusCore state="ACTIVE" size={96} />
          <h2 className="mt-8 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Coloque uma inteligência para trabalhar pelo seu dinheiro.
          </h2>
          <Link href="/cadastro" className={buttonClasses({ size: "lg", className: "mt-9" })}>
            Começar agora <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
