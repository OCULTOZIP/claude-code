"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Memory = { id: string; content: string; kind: "preference" | "fact" | "context"; createdAt: string };
const KIND = { preference: "Preferência", fact: "Fato", context: "Contexto" } as const;

export function MemoriesView({ memories }: { memories: Memory[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div>
            <h2 className="font-semibold">O que o NORBIUS lembra sobre você</h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-secondary">
              Preferências e fatos que você contou nas conversas. Saldos e movimentações nunca ficam aqui — são sempre consultados ao
              vivo. Você pode apagar qualquer item.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <form
            method="post"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const content = String(new FormData(form).get("content") ?? "");
              setLoading(true);
              setError(undefined);
              try {
                await api("/ai/memories", { method: "POST", json: { content, kind: "preference" } });
                form.reset();
                router.refresh();
              } catch (err) {
                setError(err instanceof ClientApiError ? err.message : "Não foi possível salvar.");
              } finally {
                setLoading(false);
              }
            }}
          >
            <Field className="flex-1" label="Adicionar uma preferência" name="content" maxLength={300} placeholder="Ex.: Prefiro respostas curtas" />
            <Button type="submit" variant="secondary" loading={loading}>
              Adicionar
            </Button>
          </form>
          {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
        </CardBody>
      </Card>

      {memories.length ? (
        <ul className="divide-y divide-line rounded-card border border-line bg-card">
          {memories.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <Badge>{KIND[m.kind]}</Badge>
                <span className="truncate">{m.content}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api(`/ai/memories/${m.id}`, { method: "DELETE" });
                  router.refresh();
                }}
              >
                Apagar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nenhuma memória" description='Diga ao NORBIUS algo como "lembra que recebo no dia 5" e ele guardará aqui.' />
      )}
    </div>
  );
}
