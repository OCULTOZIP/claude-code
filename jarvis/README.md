# JARVIS

Assistente pessoal de IA com capacidade de agente: voz e texto, planejamento em etapas,
execução de ferramentas do dispositivo sob permissão explícita, verificação de resultado e
relato honesto.

## Estado

**Fase de projeto.** Nenhum código de implementação foi escrito. O projeto técnico
completo está em [`PROJETO-TECNICO.md`](PROJETO-TECNICO.md), aguardando aprovação.

## Princípios inegociáveis

1. Nunca afirmar que uma ação foi executada sem o resultado da ferramenta em mãos.
2. Operar somente dentro das APIs e permissões oficiais do sistema operacional.
3. Nunca tentar contornar autenticação, sandbox ou mecanismo de segurança.
4. Sem acesso irrestrito por padrão.
5. Ação destrutiva exige confirmação vinculada aos parâmetros exatos.
6. Segredos ficam no servidor, nunca no aplicativo.
7. Qualquer permissão é revogável a qualquer momento.
8. Ferramentas reais, não simulações.
9. Dependência de plataforma sempre declarada de forma explícita.
10. Implementação funcional antes de arquitetura elaborada.
