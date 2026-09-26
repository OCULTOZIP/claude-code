import { CategoriesView } from "@/components/finance/categories-view";
import { apiGet } from "@/lib/server-api";
import type { CategoryView } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Categorias" };

export default async function CategoriesPage() {
  return <CategoriesView categories={await apiGet<CategoryView[]>("/api/v1/categories")} />;
}
