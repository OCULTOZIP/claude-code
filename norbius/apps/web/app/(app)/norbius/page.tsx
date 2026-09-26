import { ChatView, type ChatItem } from "@/components/ai/chat-view";
import { apiGet, getMe } from "@/lib/server-api";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "NORBIUS" };

type Status = { available: boolean; model: string | null; usage: { used: number; limit: number } };
type ConversationSummary = { id: string; title: string | null; lastMessageAt: string };

export default async function NorbiusPage({ searchParams }: PageProps<"/norbius">) {
  const me = await getMe();
  if (!me) redirect("/entrar");
  const sp = await searchParams;
  const current = typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  const [status, conversations] = await Promise.all([
    apiGet<Status>("/api/v1/ai/status"),
    apiGet<ConversationSummary[]>("/api/v1/ai/conversations"),
  ]);
  const conversation = current
    ? await apiGet<{ id: string; title: string | null; items: ChatItem[] }>(`/api/v1/ai/conversations/${current}`).catch(() => null)
    : null;
  return (
    <ChatView
      key={conversation?.id ?? "new"}
      available={status.available}
      usage={status.usage}
      conversations={conversations}
      conversationId={conversation?.id ?? null}
      initialItems={conversation?.items ?? []}
      name={(me.profile.displayName ?? me.user.name).split(" ")[0]!}
    />
  );
}
