import { TabsNav } from "./tabs-nav";

export function SettingsTabs() {
  return (
    <TabsNav
      label="Configurações"
      tabs={[
        { href: "/configuracoes", label: "Perfil" },
        { href: "/configuracoes/seguranca", label: "Segurança" },
        { href: "/configuracoes/categorias", label: "Categorias" },
      ]}
    />
  );
}
