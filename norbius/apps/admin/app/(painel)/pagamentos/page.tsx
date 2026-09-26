import { adminGet } from "@/lib/api";
import { brl, date } from "@/lib/format";
import { Card, CardBody } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Pagamentos" };

type Payment = { id: string; userId: string; email: string | null; amountCents: number; status: string; dueDate: string; paidAt: string | null };

export default async function PaymentsPage({ searchParams }: PageProps<"/pagamentos">) {
  const page = Math.max(1, Number((await searchParams).pagina) || 1);
  const list = await adminGet<Payment[]>(`/api/admin/payments?page=${page}`);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pagamentos da assinatura</h1>
      <Card>
        <CardBody className="pt-2">
          {list.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th className="py-2 text-left font-medium">Vencimento</th>
                  <th className="py-2 text-left font-medium">Cliente</th>
                  <th className="py-2 text-left font-medium">Situação</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular">
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{date(p.dueDate)}</td>
                    <td className="py-2">
                      <Link href={`/clientes/${p.userId}`} className="hover:underline">
                        {p.email ?? p.userId}
                      </Link>
                    </td>
                    <td className="py-2">{p.status}</td>
                    <td className="py-2 text-right">{brl(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-6 text-sm text-fg-muted">Nenhum pagamento ainda.</p>
          )}
        </CardBody>
      </Card>
      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/pagamentos?pagina=${page - 1}`} className="text-fg-secondary hover:text-fg">← Anterior</Link> : <span />}
        {list.length === 50 ? <Link href={`/pagamentos?pagina=${page + 1}`} className="text-fg-secondary hover:text-fg">Próxima →</Link> : null}
      </div>
    </div>
  );
}
