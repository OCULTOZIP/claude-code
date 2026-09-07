# JARVIS

Assistente pessoal de IA com capacidade de agente: entende linguagem natural por voz ou
texto, planeja em etapas, escolhe ferramentas, executa, verifica o resultado e relata o
que realmente aconteceu.

O projeto técnico completo está em [`PROJETO-TECNICO.md`](PROJETO-TECNICO.md).

## O que já roda

A **espinha vertical** descrita na seção 20 do projeto técnico, rodando na sua máquina: o
loop do agente, o Tool Gateway com as sete etapas, o motor de política com os níveis de
risco, a confirmação vinculada aos parâmetros, catorze ferramentas reais, memória com
filtro de sensibilidade, trilha de auditoria e uma interface de voz no navegador.

**O que isto não é.** Não é o aplicativo Android. É o mesmo backend e a mesma arquitetura
de ferramentas do projeto, com o computador fazendo o papel do aparelho. O app Android da
fase 1 reaproveita os contratos em `shared/tools/` e o desenho do gateway; o que muda são
os adaptadores, que passam a usar SAF, CalendarContract e Intent.

## Rodando

Precisa de **Python 3.10 ou superior** e de uma chave da API da Anthropic. As
dependências (`anthropic`, `fastapi`, `uvicorn`) não instalam em versões anteriores.

No macOS isso costuma exigir um passo extra: o sistema traz Python 3.9 de fábrica, e o
`run.sh` recusa começar com ele em vez de falhar no meio da instalação.

```bash
brew install python@3.12
JARVIS_PYTHON=$(brew --prefix)/bin/python3.12 ./run.sh
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...          # a chave nunca fica no código
export JARVIS_WORKSPACE=~/jarvis-workspace   # a área concedida; opcional
./run.sh                                     # abre em http://127.0.0.1:8765
```

Outros modos:

```bash
./run.sh cli      # cliente de terminal, sem navegador
./run.sh teste    # suíte de testes (49 testes, nenhum consome a API)
```

O `run.sh` cria o ambiente virtual e instala as dependências na primeira execução.

### Voz

A entrada por voz usa a Web Speech API do navegador, então o áudio é processado pelo
próprio navegador e o reconhecimento não custa nada. Isso tem um limite real: **só o
Chrome e o Edge implementam reconhecimento de voz.** No Firefox o botão do microfone fica
desabilitado e o texto continua funcionando. A resposta falada usa `speechSynthesis`, que
funciona em todos eles.

Clicar no microfone durante uma resposta interrompe a fala, que é o barge-in da seção 8.3.

## A área concedida

Toda ferramenta de arquivo enxerga apenas o diretório em `JARVIS_WORKSPACE`. Caminhos são
canonicalizados **depois** de resolver links simbólicos, e qualquer coisa que caia fora da
raiz é recusada com `OUTSIDE_GRANT`. Não existe parâmetro que amplie esse alcance em tempo
de execução.

`files.delete` não apaga: move para `.jarvis-lixeira/` dentro da área concedida. Não há
ferramenta para esvaziar a lixeira.

## Níveis de risco

| Nível | Comportamento | Ferramentas |
|---|---|---|
| 0 | Executa sozinho | `clock.now`, `memory.recall`, busca web |
| 1 | Executa se a ferramenta estiver ligada | `files.list`, `files.search`, `files.read_text`, `files.create`, `files.create_dir`, `reminders.create`, `reminders.list`, `system.open` |
| 2 | Confirmação antes | `files.move`, `memory.forget`, `memory.save` |
| 3 | Confirmação explícita sempre | `files.delete` |
| 4 | Sem implementação | — |

O nível declarado é um piso. O gateway eleva quando o lote passa de 20 itens, quando
conteúdo externo entrou no turno, ou quando a mesma ferramenta se repete demais. Uma
concessão prévia nunca dispensa a confirmação no nível 3, e nunca vale num turno em que
conteúdo externo entrou.

## Comandos para experimentar

```
que horas são em Tóquio?
crie uma pasta chamada Testes
liste meus arquivos
me lembra de ligar pro médico amanhã às 9
lembre que eu prefiro respostas curtas
o que você lembra sobre mim?
organize meus arquivos e coloque os vídeos numa pasta chamada Vídeos de Hoje
```

O último dispara o fluxo completo: buscar, criar pasta, confirmar a movimentação, mover e
relistar o destino para verificar.

## Estrutura

```
shared/tools/             contratos JSON, fonte única de verdade
backend/app/
  core/                   configuração e erros
  tools/registry.py       carrega contratos, valida esquema
  tools/gateway.py        as sete etapas; único caminho até um adaptador
  tools/adapters/         arquivos, relógio, memória, lembretes, sistema
  policy/engine.py        níveis, escalonamento, confirmação assinada
  memory/store.py         SQLite, cinco camadas, filtro de sensibilidade
  agent/orchestrator.py   loop do agente
  agent/prompt.py         prompt de sistema, estável para o cache
  api/server.py           HTTP e WebSocket
client/web/index.html     interface com voz
client/cli.py             cliente de terminal
tests/                    49 testes
```

## Segurança

- A chave da API vive só no ambiente do servidor. O navegador nunca a vê.
- A confirmação é assinada com uma chave efêmera de sessão e vinculada ao hash dos
  parâmetros exatos. Trocar os parâmetros depois da aprovação aborta a execução.
- Conteúdo vindo da web marca o turno e eleva o nível de risco de toda escrita seguinte.
- A memória recusa gravar credenciais, tokens, chaves privadas, cartões e CPF.
- O log usa lista de permissão por ferramenta: conteúdo de arquivo nunca é registrado.
- Um verificador pós-turno compara o que a resposta afirma com as ferramentas que
  realmente rodaram, e avisa quando há divergência.

## Custo

Cerca de 1,5 a 2,5 centavos de dólar por turno com o cache de prompt funcionando. O painel
de status mostra `cache` a cada turno: se esse número ficar em zero, o prefixo está sendo
invalidado e o custo triplica. Os testes não consomem API.

## Princípios

1. Nunca afirmar que uma ação foi executada sem o resultado da ferramenta em mãos.
2. Operar somente dentro das APIs e permissões oficiais do sistema.
3. Nunca tentar contornar autenticação, sandbox ou mecanismo de segurança.
4. Sem acesso irrestrito por padrão.
5. Ação destrutiva exige confirmação vinculada aos parâmetros exatos.
6. Segredos ficam no servidor, nunca no cliente.
7. Qualquer permissão é revogável a qualquer momento.
8. Ferramentas reais, não simulações.
9. Dependência de plataforma sempre declarada de forma explícita.
10. Implementação funcional antes de arquitetura elaborada.
