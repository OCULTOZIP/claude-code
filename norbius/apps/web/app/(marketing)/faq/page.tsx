import { FaqList } from "@/components/marketing/faq-list";
import { Section } from "@/components/marketing/section";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Perguntas frequentes" };

export default function FaqPage() {
  return (
    <Section eyebrow="FAQ" title="Perguntas frequentes">
      <FaqList />
    </Section>
  );
}
