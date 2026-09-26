import { TabsNav } from "./tabs-nav";

export function SettingsTabs() {
  return (
    <TabsNav
      label="Configurações"
      tabs={[
        { href: "/configuracoes", label: "Perfil" },
        { href: "/configuracoes/plano", label: "Plano" },
        { href: "/configuracoes/seguranca", label: "Segurança" },
        { href: "/configuracoes/notificacoes", label: "Avisos" },
        { href: "/configuracoes/suporte", label: "Suporte" },
        { href: "/configuracoes/categorias", label: "Categorias" },
        { href: "/configuracoes/memorias", label: "Memórias do NORBIUS" },
      ]}
    />
  );
}
