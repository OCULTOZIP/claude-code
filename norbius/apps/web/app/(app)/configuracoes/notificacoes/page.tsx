import { NotificationPreferencesForm } from "@/components/app/notification-preferences-form";
import { apiGet } from "@/lib/server-api";
import type { NotificationPreference } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Avisos" };

export default async function NotificationsSettingsPage() {
  return <NotificationPreferencesForm initial={await apiGet<NotificationPreference[]>("/api/v1/notifications/preferences")} />;
}
