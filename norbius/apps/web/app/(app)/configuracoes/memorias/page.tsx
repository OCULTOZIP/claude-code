import { MemoriesView } from "@/components/ai/memories-view";
import { apiGet } from "@/lib/server-api";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Memórias do NORBIUS" };

export type Memory = { id: string; content: string; kind: "preference" | "fact" | "context"; createdAt: string };

export default async function MemoriesPage() {
  return <MemoriesView memories={await apiGet<Memory[]>("/api/v1/ai/memories")} />;
}
