import { SettingsTabs } from "@/components/app/settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Configurações</h1>
      <SettingsTabs />
      <div className="max-w-2xl">{children}</div>
    </div>
  );
}
