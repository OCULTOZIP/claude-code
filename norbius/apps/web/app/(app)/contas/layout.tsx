import { TabsNav } from "@/components/app/tabs-nav";

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Contas</h1>
      <TabsNav
        label="Contas"
        tabs={[
          { href: "/contas", label: "Minhas contas" },
          { href: "/contas/fixas", label: "Contas fixas e receitas" },
        ]}
      />
      {children}
    </div>
  );
}
