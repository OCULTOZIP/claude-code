import { LegalPage } from "@/components/marketing/legal-page";
import { LEGAL_VERSION, PRIVACY_CONTACT } from "@/lib/legal";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      updatedAt={LEGAL_VERSION}
      sections={[
        {
          title: "Aceite",
          body: (
            <p>
              Ao criar uma conta, você concorda com estes Termos e com a{" "}
              <Link className="text-fg underline underline-offset-4" href="/privacidade">
                Política de Privacidade
              </Link>
              . Se não concordar, não utilize o serviço.
            </p>
          ),
        },
        {
          title: "O serviço",
          body: (
            <p>
              O NORBIUS é uma ferramenta de organização e análise financeira pessoal. Durante o acesso antecipado, os
              recursos são liberados em etapas e podem mudar.
            </p>
          ),
        },
        {
          title: "Natureza informativa",
          body: (
            <p>
              O NORBIUS não é instituição financeira, não custodia recursos, não realiza pagamentos e não presta
              consultoria de investimentos. Análises, insights e projeções são informativos e baseados nos dados que você
              registra; projeções são estimativas e não garantias. Decisões financeiras são de sua responsabilidade.
            </p>
          ),
        },
        {
          title: "Sua conta",
          body: (
            <ul>
              <li>Você deve ter pelo menos 18 anos e fornecer informações verdadeiras.</li>
              <li>Você é responsável por manter sua senha em sigilo e pelas atividades realizadas na sua conta.</li>
              <li>Comunique imediatamente qualquer uso não autorizado.</li>
            </ul>
          ),
        },
        {
          title: "Uso aceitável",
          body: (
            <p>
              É proibido tentar acessar dados de outros usuários, contornar mecanismos de segurança ou limites de uso,
              realizar engenharia reversa do serviço ou utilizá-lo para fins ilícitos. Violações podem levar à suspensão
              da conta.
            </p>
          ),
        },
        {
          title: "Planos",
          body: (
            <p>
              O plano Free é gratuito. Planos pagos, quando lançados, terão preço, periodicidade e condições de
              cancelamento informados antes da contratação.
            </p>
          ),
        },
        {
          title: "Disponibilidade e responsabilidade",
          body: (
            <p>
              Trabalhamos para manter o serviço disponível e seguro, mas ele pode sofrer interrupções. Na extensão
              permitida pela lei, não nos responsabilizamos por decisões tomadas com base nas informações exibidas.
            </p>
          ),
        },
        {
          title: "Encerramento",
          body: (
            <p>
              Você pode encerrar sua conta a qualquer momento. Enquanto o recurso não estiver disponível no app, envie a
              solicitação para{" "}
              <a className="text-fg underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
                {PRIVACY_CONTACT}
              </a>
              .
            </p>
          ),
        },
        {
          title: "Lei aplicável",
          body: <p>Estes Termos são regidos pelas leis da República Federativa do Brasil.</p>,
        },
      ]}
    />
  );
}
