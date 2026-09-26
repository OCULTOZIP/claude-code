import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section } from "@/components/marketing/section";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Preços" };

export default function PricingPage() {
  return (
    <Section
      eyebrow="Preços"
      title="Simples e transparente."
      description="Comece grátis. O plano Pro, com a inteligência completa do NORBIUS, será lançado em breve — os valores serão publicados aqui antes de qualquer cobrança."
    >
      <PricingCards />
    </Section>
  );
}
