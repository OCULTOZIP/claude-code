import { Alert } from "@norbius/ui";

export type LegalSection = { title: string; body: React.ReactNode };

export function LegalPage({ title, updatedAt, sections }: { title: string; updatedAt: string; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <p className="font-mono text-xs tracking-[0.24em] text-primary uppercase">Legal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-fg-muted">Versão {updatedAt}</p>
      <Alert tone="warning" className="mt-8">
        Versão preliminar, publicada durante o acesso antecipado e sujeita a revisão jurídica antes do lançamento
        comercial. Alterações relevantes serão comunicadas aos usuários.
      </Alert>
      <div className="mt-12 flex flex-col gap-10">
        {sections.map((s, i) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">
              <span className="mr-2 font-mono text-sm text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-fg-secondary [&_li]:ml-5 [&_li]:list-disc">
              {s.body}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
