import { formatBRL, FREE_MAX_ACTIVE_GOALS, PRO_AI_MESSAGES_PER_MONTH, PRO_PRICE_CENTS, TRIAL_DAYS } from "@norbius/domain";
// Conteúdo do site de marketing. Disponibilidade de cada recurso é explícita:
// o site nunca apresenta como pronto algo que ainda não existe no produto.

export type Availability = "available" | "soon";

export const FEATURES: { title: string; description: string; availability: Availability }[] = [
  {
    title: "Conta segura",
    description: "Cadastro com verificação de e-mail, senha protegida com Argon2id e controle das sessões abertas.",
    availability: "available",
  },
  {
    title: "Contas e transações",
    description: "Registre receitas, despesas e transferências entre suas contas, com categorias e recorrências.",
    availability: "available",
  },
  {
    title: "Cartões de crédito",
    description: "Limite, faturas, parcelas e vencimentos organizados sem contar o mesmo gasto duas vezes.",
    availability: "available",
  },
  {
    title: "Metas",
    description: "Defina objetivos, acompanhe aportes e veja o ritmo necessário para chegar lá.",
    availability: "available",
  },
  {
    title: "Assistente NORBIUS",
    description: "Converse em português: registre gastos, consulte saldos e entenda sua situação em segundos. Incluído no plano Pro.",
    availability: "available",
  },
  {
    title: "Projeções e insights",
    description: "Estimativas de saldo com premissas claras e alertas quando algo merece sua atenção.",
    availability: "soon",
  },
];

export const STEPS = [
  {
    n: "01",
    title: "Conte o essencial",
    description: "Uma conversa rápida para entender renda, contas e compromissos. Você pula o que quiser.",
  },
  {
    n: "02",
    title: "Registre do seu jeito",
    description: "Pela interface ou em linguagem natural: “gastei 50 no mercado”. O NORBIUS organiza.",
  },
  {
    n: "03",
    title: "Entenda e antecipe",
    description: "Padrões, comparações e projeções baseadas nos seus dados — nunca em suposições escondidas.",
  },
];

export const PRINCIPLES = [
  {
    title: "Números vêm dos seus dados",
    description: "Todo valor exibido é calculado a partir do que você registrou. A inteligência interpreta; não inventa.",
  },
  {
    title: "Estimativa é estimativa",
    description: "Projeções aparecem sempre rotuladas, com premissas e nível de confiança.",
  },
  {
    title: "Nada muda sem você",
    description: "Alterações e exclusões pedidas ao assistente exigem sua confirmação explícita.",
  },
];

export const SECURITY = [
  { title: "Isolamento por usuário", description: "Regras no próprio banco de dados impedem que um usuário acesse dados de outro." },
  { title: "Senhas com Argon2id", description: "Sua senha nunca é armazenada; guardamos apenas um hash resistente a ataques." },
  { title: "Sessões sob controle", description: "Veja os dispositivos conectados e encerre qualquer sessão quando quiser." },
  { title: "Sem venda de dados", description: "Seus dados financeiros não são vendidos nem usados para publicidade." },
];

export const PLANS = [
  {
    id: "free",
    name: "Grátis",
    price: "R$ 0",
    period: "para sempre",
    description: "Para organizar o dia a dia financeiro.",
    features: [
      "Painel com seus dados reais",
      "Contas, transações, categorias e transferências",
      "Cartões com parcelas e faturas",
      "Contas fixas e receitas recorrentes",
      `Até ${FREE_MAX_ACTIVE_GOALS} metas ativas`,
      "Exportação em CSV",
    ],
    cta: { label: "Começar grátis", href: "/cadastro" },
  },
  {
    id: "pro",
    name: "Pro",
    price: formatBRL(PRO_PRICE_CENTS.monthly),
    period: `por mês · ou ${formatBRL(PRO_PRICE_CENTS.yearly)} por ano`,
    description: "Com o assistente NORBIUS.",
    features: [
      "Tudo do plano grátis",
      `Assistente NORBIUS: pergunte e registre conversando (até ${PRO_AI_MESSAGES_PER_MONTH} mensagens por mês)`,
      "Metas ilimitadas",
      `${TRIAL_DAYS} dias grátis, sem cartão`,
      "Pix, boleto ou cartão · cancele quando quiser",
    ],
    cta: { label: `Testar ${TRIAL_DAYS} dias grátis`, href: "/cadastro" },
  },
] as const;

export const FAQ = [
  {
    q: "O que é o NORBIUS?",
    a: "Um sistema de inteligência financeira pessoal. Ele organiza suas movimentações, identifica padrões e ajuda você a entender e antecipar sua vida financeira, sempre com base nos dados que você registra.",
  },
  {
    q: "O NORBIUS se conecta ao meu banco?",
    a: "Ainda não. Nesta primeira versão os registros são feitos por você, pela interface ou conversando com o NORBIUS. A integração com Open Finance está planejada para uma etapa futura e só acontecerá com o seu consentimento explícito.",
  },
  {
    q: "O NORBIUS dá recomendações de investimento?",
    a: "Não. O NORBIUS não é instituição financeira nem consultor de valores mobiliários. Ele organiza e analisa seus dados para fins informativos e não recomenda produtos financeiros específicos.",
  },
  {
    q: "As projeções são garantidas?",
    a: "Não. Projeções são estimativas feitas a partir do seu histórico e dos compromissos cadastrados. Elas aparecem sempre identificadas como estimativas, com as premissas usadas.",
  },
  {
    q: "Meus dados estão seguros?",
    a: "Segurança é requisito desde a fundação: isolamento de dados por usuário no banco, senhas protegidas com Argon2id, verificação de e-mail, limite de tentativas de login e registro de eventos de segurança.",
  },
  {
    q: "Posso excluir minha conta e meus dados?",
    a: "Sim. Você terá acesso à exportação e à exclusão dos seus dados, em conformidade com a LGPD. Enquanto o fluxo automático não estiver disponível no app, a solicitação pode ser feita pelo canal indicado na Política de Privacidade.",
  },
  {
    q: "Quanto custa?",
    a: `O plano grátis não tem custo e não expira. O Pro custa ${formatBRL(PRO_PRICE_CENTS.monthly)} por mês ou ${formatBRL(PRO_PRICE_CENTS.yearly)} por ano, com ${TRIAL_DAYS} dias de teste grátis sem cartão. O pagamento é feito por Pix, boleto ou cartão pelo Asaas; o NORBIUS não recebe os dados do seu cartão. Você pode cancelar quando quiser e continua com o Pro até o fim do período já pago.`,
  },
];
