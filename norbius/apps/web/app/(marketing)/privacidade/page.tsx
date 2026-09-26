import { LegalPage } from "@/components/marketing/legal-page";
import { LEGAL_VERSION, PRIVACY_CONTACT } from "@/lib/legal";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      updatedAt={LEGAL_VERSION}
      sections={[
        {
          title: "Quem somos",
          body: (
            <p>
              O NORBIUS é um serviço de organização e inteligência financeira pessoal. Esta política explica quais dados
              tratamos, por quê e quais são os seus direitos, nos termos da Lei Geral de Proteção de Dados (Lei nº
              13.709/2018 — LGPD).
            </p>
          ),
        },
        {
          title: "Dados que coletamos",
          body: (
            <ul>
              <li>Cadastro: nome, e-mail, senha (armazenada apenas como hash Argon2id) e, se usar o login com Google, os dados básicos do perfil Google.</li>
              <li>Segurança: endereço IP, navegador/dispositivo e datas de acesso das sessões.</li>
              <li>Dados financeiros que você mesmo registrar (contas, transações, cartões, metas), quando esses recursos estiverem disponíveis.</li>
              <li>Registros de consentimento (versão dos Termos e desta Política aceita no cadastro).</li>
            </ul>
          ),
        },
        {
          title: "O que não coletamos",
          body: (
            <p>
              Não pedimos CPF, endereço, número completo de cartão nem senhas bancárias. Não acessamos sua conta bancária.
            </p>
          ),
        },
        {
          title: "Para que usamos os dados",
          body: (
            <ul>
              <li>Prestar o serviço contratado (base legal: execução de contrato).</li>
              <li>Proteger sua conta e prevenir fraudes, como limitar tentativas de login e registrar eventos de segurança (base legal: legítimo interesse e cumprimento de obrigação legal).</li>
              <li>Enviar e-mails essenciais: verificação de conta, redefinição de senha e avisos de segurança.</li>
            </ul>
          ),
        },
        {
          title: "Inteligência artificial",
          body: (
            <p>
              Quando o assistente NORBIUS estiver disponível, trechos necessários para responder às suas perguntas serão
              processados por um provedor de modelos de linguagem que pode estar localizado fora do Brasil. Informaremos o
              provedor, a finalidade e as salvaguardas contratuais antes de ativar o recurso, que não utilizará seus dados
              para treinar modelos.
            </p>
          ),
        },
        {
          title: "Compartilhamento",
          body: (
            <p>
              Não vendemos seus dados nem os usamos para publicidade. Compartilhamos apenas com operadores necessários à
              prestação do serviço (hospedagem, envio de e-mails), sob contrato e com obrigações de confidencialidade.
            </p>
          ),
        },
        {
          title: "Acesso interno",
          body: (
            <p>
              A equipe do NORBIUS não tem acesso irrestrito aos seus dados financeiros. Qualquer acesso excepcional, como
              para resolver um chamado de suporte, dependerá da sua autorização, será limitado ao necessário e registrado
              em auditoria.
            </p>
          ),
        },
        {
          title: "Segurança",
          body: (
            <p>
              Adotamos isolamento de dados por usuário no banco de dados, criptografia em trânsito, hash de senhas com
              Argon2id, limite de tentativas de autenticação e registro de eventos de segurança.
            </p>
          ),
        },
        {
          title: "Retenção",
          body: (
            <p>
              Mantemos seus dados enquanto sua conta estiver ativa. Registros de segurança são mantidos por até 1 ano.
              Após a exclusão da conta, os dados são removidos em até 30 dias, salvo obrigação legal de guarda.
            </p>
          ),
        },
        {
          title: "Seus direitos",
          body: (
            <>
              <p>
                Você pode solicitar confirmação de tratamento, acesso, correção, portabilidade, anonimização e exclusão dos
                seus dados, além de revogar consentimentos.
              </p>
              <p>
                Enquanto a exportação e a exclusão automáticas não estiverem disponíveis no app, envie sua solicitação para{" "}
                <a className="text-fg underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
                  {PRIVACY_CONTACT}
                </a>
                .
              </p>
            </>
          ),
        },
        {
          title: "Encarregado (DPO) e contato",
          body: (
            <p>
              Dúvidas sobre privacidade:{" "}
              <a className="text-fg underline underline-offset-4" href={`mailto:${PRIVACY_CONTACT}`}>
                {PRIVACY_CONTACT}
              </a>
              . Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).
            </p>
          ),
        },
      ]}
    />
  );
}
