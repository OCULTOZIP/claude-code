"use client";
import { api, ClientApiError } from "@/lib/client-api";
import type { CategoryView } from "@norbius/contracts";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, SelectField } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CategoriesView({ categories }: { categories: CategoryView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const groups = [
    { kind: "expense" as const, label: "Despesas" },
    { kind: "income" as const, label: "Receitas" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div>
            <h2 className="font-semibold">Nova categoria</h2>
            <p className="mt-1 text-sm text-fg-secondary">As categorias do sistema estão sempre disponíveis. Crie as suas para detalhar mais.</p>
          </div>
        </CardHeader>
        <CardBody>
          <form
            method="post"
            className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              setLoading(true);
              setError(undefined);
              try {
                await api("/categories", { method: "POST", json: { name: f.get("name"), kind: f.get("kind") } });
                form.reset();
                router.refresh();
              } catch (err) {
                setError(err instanceof ClientApiError ? err.message : "Não foi possível criar.");
              } finally {
                setLoading(false);
              }
            }}
          >
            <Field label="Nome" name="name" maxLength={40} placeholder="Ex.: Pets" />
            <SelectField label="Tipo" name="kind" defaultValue="expense" options={groups.map((g) => ({ value: g.kind, label: g.label }))} />
            <Button type="submit" loading={loading}>
              Criar
            </Button>
          </form>
          {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
        </CardBody>
      </Card>
      {groups.map((g) => (
        <section key={g.kind}>
          <h2 className="mb-3 text-sm font-medium text-fg-secondary">{g.label}</h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-card">
            {categories
              .filter((c) => c.kind === g.kind)
              .map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>{c.name}</span>
                  {c.system ? (
                    <Badge>Sistema</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api(`/categories/${c.id}/archive`, { method: "POST", json: {} });
                        router.refresh();
                      }}
                    >
                      Arquivar
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
