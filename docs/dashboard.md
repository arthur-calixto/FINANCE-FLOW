# Dashboard financeiro — FIN-11

A rota autenticada `/app` é o Dashboard e o primeiro item da navegação. O endpoint
`GET /dashboard?month=YYYY-MM` entrega os indicadores em uma única resposta. Exige
JWT Supabase válido, `X-Workspace-Id` e membership consultada em cada requisição.
OWNER e MEMBER enxergam os mesmos dados do workspace, independentemente de autoria.
VIEWER mantém leitura; ações rápidas de escrita não são apresentadas para essa role.

## Competência e dinheiro

A seleção mensal usa a mesma `Transaction.competenceDate` dos lançamentos: primeiro
dia do mês de vencimento para lançamentos comuns; mês de referência da fatura para
compras de cartão. `createdAt`, data da compra e data da baixa não substituem a
competência. Assim, uma compra em setembro que vence na fatura de outubro aparece
em outubro. O mês controla resumo, pendências, vencimentos, categorias, composição
e o término da evolução. Saldo de contas e utilização dos cartões são atuais e
independentes desse filtro, explicitamente identificados na interface.

Todos os valores monetários são strings decimais com duas casas. PostgreSQL faz as
agregações e `Prisma.Decimal` com precisão 40 faz operações derivadas. Não há soma
monetária com `Number`; a Web usa números somente para posições/tamanhos dos SVGs
ou barras, e formata os valores textuais originais em BRL.

- **Planned:** soma de `expectedAmount` dos registros não CANCELLED. Reutiliza
  `transactionTotals`, também chamado pelo summary/month-view de Transactions.
- **Actual:** soma de `amount` somente quando o status é PAID, preservando a regra
  existente. Um valor conhecido antes da baixa não é realizado.
- **Pending:** para PENDING/OVERDUE, soma `amount ?? expectedAmount ?? 0`, a mesma
  precedência de valor usada pela baixa quando nenhum valor novo é informado.
  Pago e cancelado contribuem zero. Isso não é `planned - actual`.
- **Resultado:** receitas menos despesas, calculado separadamente para previsto,
  realizado e pendências. Não representa saldo acumulado em conta.

Um lançamento permitido pela API existente pode ter somente `amount`. Nesse caso,
o previsto continua zero: não alteramos retroativamente a semântica da FIN-5/FIN-9.
Se estiver pendente, seu valor conhecido participa de pending. Se a baixa divergir
do previsto, o realizado usa o valor efetivo. Essas diferenças explicam por que
previsto não é necessariamente realizado mais pendente.

## Cartões e faturas sem duplicidade

Compras e parcelas de cartão são Transactions, e representam a despesa econômica.
A FIN-6 já marca as compras não canceladas como PAID ao pagar a fatura. O Dashboard
lê esse estado, sem inferir uma regra diferente a partir da fatura.

**Pagamento de fatura não representa uma segunda despesa econômica.**
`CreditCardInvoice.paidAmount/paymentAccountId` participam somente do cálculo de
caixa. Não entram novamente nos totais econômicos, categorias ou composição.

`CreditCardsService.listInTransaction` é usado tanto por `/credit-cards` quanto
pelo Dashboard. A leitura foi consolidada: cartões em uma consulta, utilização
agrupada por cartão, próxima fatura por `DISTINCT ON` no banco e totais agrupados
por fatura. Não há uma consulta por cartão. O serviço individual também usa a
mesma apresentação, e a regra de `used()` foi preservada:

- limite usado = amount das compras não canceladas com fatura ainda não paga;
- disponível = limite total menos usado, incluindo parcelas futuras materializadas;
- próxima fatura = primeira fatura não paga com compras válidas, ordenada por
  vencimento/id; pode estar vencida;
- cartões inativos não aparecem nesta seção, mas suas despesas válidas permanecem
  nos indicadores do mês.

Não misturamos limite de cartão com dinheiro disponível em conta.

## Saldo das contas

`AccountBalancesService.current(tx, workspaceId)` centraliza o novo cálculo
reutilizável, sem persistir saldo derivado. Para cada conta ativa:

```text
initialBalance
+ amount de receitas PAID vinculadas à conta, sem cartão/fatura
- amount de despesas PAID vinculadas à conta, sem cartão/fatura
- paidAmount de faturas PAID vinculadas à conta de pagamento
+ Transfer.amount de entradas
- Transfer.amount de saídas
```

A soma dos saldos das contas ativas produz `accounts.totalBalance`. Contas inativas
não entram nesse total. O cálculo considera movimentos confirmados de todas as
competências; não é posição histórica ao final do mês selecionado e não filtra
lançamentos PAID pela data informada em paidAt.

Transfer já existe no schema, mas não possui status nem fluxo operacional nesta
etapa. Registros presentes são tratados como transferências confirmadas. Testamos
esse suporte no banco, sem criar endpoint ou formulário de transferência. Valores
transferidos entre duas contas ativas não alteram o saldo total nem o resultado.

## Recorrências, parcelas, categorias e composição

O endpoint chama `ensureRecurrenceHorizon` antes da leitura, exatamente como
Transactions. Usa somente ocorrências e parcelas materializadas; não projeta
receitas/despesas por uma fórmula paralela. Reaproveita revisões, janela móvel de
12 meses, parcelas retroativas e tombstones de ocorrências excluídas. Um mês fora
da janela não recebe ocorrências virtuais inventadas pelo Dashboard.

Despesas por categoria somam o **previsto**; vínculos nulos são “Sem categoria”.
Categorias inativas ainda classificam seus registros históricos. Categorias com
previsto zero são omitidas do gráfico, sem alterar a reconciliação.

A composição reutiliza `transactionGroupKey`, da FIN-9:

- Cartões: EXPENSE com creditCardId, com prioridade sobre outras origens;
- Fixas / recorrentes: EXPENSE com recurrenceId e sem cartão;
- Outras: EXPENSE sem recurrenceId e sem cartão, incluindo parcelas comuns.

Soma das categorias = soma das três composições = despesas previstas. Percentuais
são calculados com Decimal e uma casa; arredondamentos podem somar 99,9% ou 100,1%.
Total zero retorna percentuais zero e mensagem textual, sem gráfico inválido.

## Próximos vencimentos e evolução

Próximos vencimentos mostra até dez Transactions PENDING/OVERDUE **da competência
selecionada**, ordenadas por dueDate e id. Inclui atrasados e receitas, sem pagos ou
cancelados. A origem é derivada (cartão, recorrente, parcelamento, avulso), nunca
persistida. Compras do cartão aparecem individualmente, sem repetir o valor da
fatura. O valor segue a mesma precedência de pending. O status de atraso é derivado
em relação à data civil brasileira.

“Ver lançamentos” preserva `?month=YYYY-MM`, agora reconhecido na abertura da tela
de Transactions. “Ver cartão” abre a fatura em aberto ou a lista de faturas.

Evolução mostra seis competências consecutivas terminando no mês selecionado,
com zeros para meses vazios. Usa os mesmos grupos e `transactionTotals` do resumo.
O seletor Previsto/Realizado apresenta três séries (receitas, despesas, resultado),
com valores textuais completos, sem depender de tooltip. O SVG não exige biblioteca
nova. Resultados negativos ficam abaixo da linha zero e têm indicação textual.
Para manter seis meses no calendário suportado, aceita competências entre
0001-06 e 9999-12; mês ausente/inválido ou parâmetros desconhecidos retornam 400.

## Contrato e consistência

O contrato compartilhado está em `DashboardResponse`, em packages/types:

```text
month, hasActivity, transactionCount
summary: income/expense { planned, actual, pending }, result { planned, actual, pending }
accounts: { totalBalance, items[] }
upcoming[]
expensesByCategory[]: { id, name, amount, percentage }
expenseComposition: { recurring, creditCards, other, total, percentages }
creditCards[]: contrato da FIN-6 + usagePercentage
evolution[]: { month, ...summary }
```

As leituras usam uma única transação RepeatableRead depois da materialização de
recorrências. Agrupamento mensal no PostgreSQL é limitado às seis competências;
nenhum histórico completo de Transactions é carregado no Node. Saldos de contas
usam agregações por conta/tipo; nomes de categorias são carregados em lote.
Consultas sempre restringem workspaceId. Índices existentes por workspace/competência,
workspace/vencimento, conta, cartão e fatura atendem às leituras. **Sem migration:**
não houve mudança estrutural ou necessidade comprovada de índice adicional.

A materialização de recorrências mantém o fluxo existente, inclusive seus locks.
Leituras concorrentes foram exercitadas para verificar que uma ocorrência excluída
não reaparece. Nenhum cache de autorização foi adicionado: remoção de membership
revoga a próxima chamada de Dashboard mesmo com JWT válido.

## Interface e atualização

A Web faz uma requisição para indicadores. Apenas ao abrir uma ação rápida carrega
contas/categorias para o `TransactionDialog` existente, sem duplicar formulário.
Receita/despesa vêm pré-selecionadas. Ao criar em outro mês, o formulário inicia as
datas no primeiro dia da competência; o usuário pode ajustá-las. Salvar atualiza o
Dashboard. Se escolher outro vencimento, a movimentação pertence a esse outro mês.

Trocar mês aborta a leitura anterior; trocar workspace desmonta o conteúdo e limpa
os dados/formulários anteriores. Há loading, retry, workspace sem movimentações,
mês vazio, nenhuma conta/cartão, nenhuma despesa prevista e nenhum vencimento.
No mobile, resultado vem antes de receitas/despesas; vencimentos, contas e cartões
precedem as análises. Listas e gráfico se ajustam à largura disponível.

Não existe atualização em tempo real entre sessões. Alterações de outra pessoa
aparecem ao recarregar/entrar na tela ou consultar novamente outra competência.

## Testes e validação

`apps/api/test/dashboard.integration.mjs` usa HTTP/JWT e PostgreSQL local para:

- reconciliação com summary e month-view, categorias, composição e resultado;
- OWNER/MEMBER, ausência/remoção de membership, isolamento PERSONAL e mês inválido;
- previsto/realizado/pendente, cancelados, baixas divergentes e previsto ausente;
- fatura paga sem duplicação econômica/caixa, limites e igualdade com a tela de cartões;
- recorrências, parcelas comuns/retroativas, tombstone e leituras concorrentes;
- saldos, transferências, contas inativas, precisão acima de Number e meses vazios;
- evolução de seis competências e limite/ordenação dos próximos vencimentos.

Fixtures controlados são restritos ao banco local e removidos ao terminar.
`apps/web/src/Dashboard.test.tsx` cobre estados, navegação mensal, valores BRL,
análises, evolução, negativos, isolamento ao trocar workspace, VIEWER e ações
rápidas usando o formulário real. As suítes anteriores permanecem preservadas.

## Resultado da validação — 05/10/2026

Todos os comandos passaram:

| Comando                          | Resultado                                                        |
| -------------------------------- | ---------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Instalação conferida; lockfile preservado, sem novas bibliotecas |
| `pnpm lint`                      | ESLint e TypeScript aprovados                                    |
| `pnpm build`                     | API e Web compiladas                                             |
| `pnpm test`                      | 48 testes API e 111 Web aprovados                                |
| `pnpm format:check`              | Aprovado                                                         |
| `pnpm db:validate`               | Schema válido                                                    |
| `pnpm test:database`             | 99 testes de integração aprovados                                |
| `pnpm db:test`                   | 14 modelos exercitados; ROLLBACK concluído                       |

No cenário controlado Arthur/Maria, ambos viram outubro/2026 com receitas previstas
R$ 6.000, realizadas R$ 5.000 e a receber R$ 1.000; despesas previstas R$ 2.650,
realizadas R$ 1.800 e a pagar R$ 850. Resultado previsto R$ 3.350, realizado
R$ 3.200 e pendências líquidas R$ 150. Os saldos iniciais de R$ 100 + R$ 200
produziram saldo atual total de R$ 3.500. Composição: recorrentes R$ 1.750,
cartões R$ 600, outras R$ 300. Limite usado R$ 600 e disponível R$ 4.400.

O teste API também pagou a fatura de R$ 600: previsto permaneceu R$ 2.650,
realizado foi a R$ 2.400 e o saldo total a R$ 2.900, sem inserir uma segunda despesa.

Validação real no Chromium com dois contexts independentes, API/PostgreSQL locais
e identidades de teste assinadas. O provedor externo Supabase foi simulado; não
foram criadas contas externas nem dados de produção. Maria criou uma despesa de
R$ 350 pela ação rápida: seu dashboard atualizou e Arthur recebeu os mesmos valores
ao recarregar. Também foram conferidos isolamento pessoal, seletor de workspace,
navegação de competência, formulário existente, modo Previsto/Realizado e vazios.
Fixtures foram removidos ao terminar.

Desktop 1440×1050, tablet 820×1180 e celular 390×844: sem overflow horizontal ou
erros no console, BRL legível e resultado antes dos demais cards no celular.
Evidências: [desktop](screenshots/fin11-desktop.png),
[tablet](screenshots/fin11-tablet.png) e [celular](screenshots/fin11-mobile.png).

Avisos preexistentes, não bloqueantes: chunk Web acima de 500 kB e depreciação de
consultas simultâneas no driver `pg`. Não houve migration, reset, exclusão de dados
existentes ou commit desta implementação.
