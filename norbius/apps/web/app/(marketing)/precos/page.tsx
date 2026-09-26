import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section } from "@/components/marketing/section";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Preços" };

export default function PricingPage() {
  return (
    <Section
      eyebrow="Preços"
      title="Simples e transparente."
      description="Comece grátis. Quando quiser o assistente NORBIUS, teste o Pro por 7 dias sem cartão — sem cobrança automática ao fim do teste."
    >
      <PricingCards />
    </Section>
  );
}
