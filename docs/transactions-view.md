# Visão mensal e exclusão definitiva — FIN-9

`/app/transactions` organiza a competência selecionada em RECEITAS e DESPESAS. Dashboard permanece fora desta entrega, na FIN-10.

## Hierarquia e classificação

| Seção                                       | Origem da Transaction                      |
| ------------------------------------------- | ------------------------------------------ |
| Receitas → Fixas / recorrentes              | INCOME com recurrenceId                    |
| Receitas → Outras receitas                  | INCOME sem recurrenceId                    |
| Despesas → Fixas / recorrentes              | EXPENSE com recurrenceId, sem creditCardId |
| Despesas → Cartões de crédito → cada cartão | EXPENSE com creditCardId                   |
| Despesas → Outras despesas                  | EXPENSE sem recurrenceId nem creditCardId  |

`transactionGroupKey`, no pacote types, compartilha somente a classificação pela origem. Não existe isFixed. Parcelamento comum entra em outras receitas/despesas; parcela de cartão fica no respectivo cartão. Número e quantidade vêm dos campos estruturados, sem extrair texto da descrição.

Todos os grupos começam abertos e podem ser recolhidos com teclado ou mouse. Vazios ocupam uma linha discreta. A navegação mensal e os botões Nova receita/Nova despesa permanecem, incluindo os formulários existentes de parcelamento. Recorrências e compras continuam acessíveis pelos fluxos e links existentes.

## Tabelas, resumo e filtros

Desktop usa tabelas: descrição/conta, categoria, vencimento, previsto, recebido/pago, status e ações. Cartões usam descrição, categoria, data da compra, parcela, valor, status e ações. Cabeçalho de cartão mostra nome, subtotal, competência e vencimento da fatura, situação Paga/Pendente e link para o detalhe.

Ordens: comuns por dueDate, descrição pt-BR e ID; cartão por transactionDate, descrição pt-BR e ID. Cartões por nome. Até 1150 px as linhas viram registros em grade de três colunas; até 600 px, duas colunas, com descrição e ações em largura completa. Não há tabela de sete colunas espremida no celular. Dinheiro e datas mantêm pt-BR.

Resumo compacto: Receitas previstas, Despesas previstas, Resultado previsto, com realizado secundário. Resultado é a diferença exata entre as duas somas retornadas pelo backend, usando centavos inteiros. Grupos e cada cartão também apresentam previsto/realizado. Diferença entre valor previsto e baixa permanece visível na linha. Amount conhecido antes da baixa é identificado como ainda não realizado.

Busca por descrição, status, conta e categoria combinam-se por AND dentro do mês. O antigo filtro de tipo saiu da interface porque a hierarquia já separa receitas/despesas; continua disponível na API. **Resumo e subtotais da nova tela acompanham os filtros**, com aviso explícito quando filtrados. Assim, o subtotal sempre corresponde às linhas exibidas. O endpoint anterior de summary continua sendo o resumo completo da competência.

Pagar/Receber fica visível. Editar, Reabrir, Cancelar e Excluir definitivamente ficam no menu ⋮, conforme elegibilidade. Compras usam link para a fatura para pagamento/cancelamento. Bloqueios de exclusão vêm da API e são explicados no menu. VIEWER não recebe ações de escrita. Troca de workspace remonta a tela, descarta diálogos/dados e aborta leituras antigas.

## Fonte única dos totais

`transactionTotals` é reutilizada pelo summary, pela visão mensal e pelos subtotais:

- previsto soma expectedAmount dos registros não CANCELLED, inclusive PAID; null contribui zero;
- realizado soma amount somente de PAID;
- competência é competenceDate, não a data da baixa;
- amount conhecido em PENDING não representa realizado;
- Recurrence não é somada: somente suas Transactions;
- pagamento de fatura não gera segunda despesa;
- cancelado não entra em nenhuma soma ativa; excluído fisicamente não existe nas consultas.

Cálculo usa Decimal com precisão 40, sem Number para dinheiro. A visão mensal lê Transactions e relações em snapshot RepeatableRead, retornando linhas e totais desse mesmo conjunto. Includes obtêm conta, categoria, cartão, fatura e grupo de parcelas em consultas por relação, sem uma consulta por linha. O materializador já existente mantém a janela de recorrências antes da leitura. Não foram introduzidos cache ou agregados financeiros persistidos.

## Contratos REST

JWT, X-Workspace-Id e membership obrigatórios. Escritas exigem OWNER/ADMIN/MEMBER. UUID de outro workspace retorna 404; workspace sem membership ou VIEWER tentando escrever retorna 403.

| Método | Rota                                     | Contrato                                                                                            |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/transactions/month-view?month=2026-10` | Mês obrigatório; aceita filtros existentes. Retorna rows, summary e subtotals.                      |
| POST   | `/transactions/:id/cancel`               | Cancelamento bancário explícito; HTTP 200.                                                          |
| DELETE | `/transactions/:id`                      | Alias legado de cancelamento, preservado; **não faz hard delete**.                                  |
| DELETE | `/transactions/:id/permanent`            | Exclusão real; body obrigatório `{ "confirm": true }`; HTTP 200 `{ "id": "...", "deleted": true }`. |

Não houve mudança silenciosa do DELETE antigo. A Web usa POST /cancel; consumidores anteriores continuam compatíveis. Cancelamento de compra simples continua na rota do cartão; cancelamento de parcelamento de cartão continua por grupo.

`subtotals` é um mapa com chaves incomeFixed, incomeOther, expenseFixed, expenseOther, `card:UUID` e cards. Grupos ausentes significam zero; cards sempre existe. Cada valor contém expected e realized como strings decimais. summary conserva o contrato income/expense existente. Rows incluem invoice com dueDate/status e permanentDeleteBlockedReason (texto ou null). O servidor revalida a elegibilidade ao excluir; a mensagem exibida no cliente não substitui essa validação.

Confirmação ausente/falsa/string ou campos desconhecidos retorna 400. Estado bloqueado retorna 409. Nova exclusão do mesmo ID retorna 404. A interface exige diálogo, aviso de irreversibilidade e checkbox obrigatório, além do botão destrutivo. PAID avisa que a baixa também sai dos totais; recorrência avisa que somente aquela ocorrência será removida.

## Cancelar versus excluir

Cancelar mantém Transaction e histórico, altera status para CANCELLED e retira valores dos totais. O fluxo bancário exige reabrir PAID antes de cancelar. Excluir remove a Transaction do banco, lista, consulta por ID, resumo, fatura e demais detalhes. Não cria histórico financeiro visível nem soft delete. Não existe recuperação pela aplicação.

| Origem/estado                                   | Exclusão definitiva                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simples PENDING/OVERDUE/CANCELLED               | Permitida com confirmação.                                                                                                                                                            |
| Simples PAID                                    | Permitida com confirmação forte; amount/paidAt desaparecem com a Transaction. Não existem ledger/saldos derivados persistidos desse evento no sistema atual.                          |
| Parcela comum                                   | Exclusão individual permitida, inclusive PAID com confirmação; preserva números originais, total contratado e início do controle.                                                     |
| Compra simples de cartão, fatura não paga       | Permitida; total de fatura, limite e resumo derivados refletem a ausência imediatamente.                                                                                              |
| Compra em fatura paga, inclusive cancelada      | Bloqueada: “Esta compra pertence a uma fatura já paga e não pode ser excluída diretamente.”                                                                                           |
| Parcela de cartão                               | Bloqueada individualmente, mesmo em fatura não paga. Preserva a regra FIN-7 de compromisso/cancelamento por compra inteira; não implementa estorno nem renegociação parcial do grupo. |
| Ocorrência recorrente, inclusive PAID/CANCELLED | Permitida com confirmação e exclusão técnica da identidade original; próximos meses permanecem.                                                                                       |

Não há exclusão em lote, exclusão da série inteira, reabertura/estorno de fatura nem exclusão de Account/Category. Para séries continua existindo Encerrar recorrência. Essas decisões seguem as alternativas permitidas na especificação.

### Limpeza atômica

Após excluir uma compra, a fatura só é removida se não PAID, sem paidAt/paidAmount/paymentAccountId e sem nenhuma Transaction — inclusive CANCELLED. Fatura paga nunca é removida por essa operação. Após excluir a última parcela comum, remove-se também o InstallmentGroup vazio; não há outras dependências desse grupo no schema atual. Contas, categorias e cartão são preservados.

Todas as ações estão na mesma transação PostgreSQL: marca de recorrência, DELETE Transaction e limpezas. Falha reverte a operação inteira. Usa o mesmo lock consultivo por workspace de baixas, materialização e faturas, seguido do lock de cartão quando aplicável e da linha Transaction. Assim, exclusão e pagamento não deixam uma compra removida em fatura consolidada: se o pagamento vence a corrida, a exclusão recebe 409; se a exclusão vence, o pagamento lê o conjunto atualizado ou recebe 404 para fatura vazia removida. Duas exclusões retornam sucesso e 404; exclusão versus baixa comum não deixa saldo derivado órfão.

## Schema e migration

Migration aditiva `20260930122000_transaction_deletion`, aplicada com `pnpm db:migrate`, sem reset:

- `InstallmentGroup.startingInstallment`, default 1, CHECK entre 1 e installmentCount. Backfill pelo menor installmentNumber antes de habilitar exclusões. Criação persiste a parcela inicial do plano. Leitura usa esse campo, não o menor número restante; controlledInstallmentCount = installmentCount − startingInstallment + 1. controlledAmount recompõe o plano original com a mesma divisão exata da FIN-7. São metadados do controle inicial, não totais das parcelas que ainda existem. Excluir 5/10 mantém 6/10, não vira 5/9.
- `RecurrenceOccurrenceExclusion`: recurrenceId, workspaceId, recurrenceDate e createdAt. Chave primária (recurrenceId, recurrenceDate), FK composta para Recurrence do mesmo workspace e índice por workspace/recorrência. Não contém descrição, valor, status ou cópia de Transaction.

O materializador consulta exclusões no intervalo processado e descarta essas datas antes de createMany. A identidade é recurrenceDate original, mesmo após editar vencimento/competência. Reiniciar nextGenerationDate ou revisitar o mês não recria a ocorrência. A marca técnica nunca é retornada como lançamento/histórico financeiro. A série e suas revisões continuam existindo.

## Validação

Testes API cobrem regra única de totais, precisão acima de Number, classificação pela origem e confirmação literal. Testes PostgreSQL cobrem o dataset oficial, filtros, resumo consistente, cancelamento versus hard delete, PAID, compras, limite/faturas vazias, bloqueio de fatura paga e parcela de cartão, numeração/controle retroativo, remoção de grupo vazio, recorrência sem recriação com cursor reiniciado e vencimento alterado, permissões e três cenários de concorrência. O script SQL cobre também unicidade/isolamento da exclusão técnica e CHECK do início do controle.

Web cobre hierarquia, subtotais, recolhimento, previsto/realizado, menus, confirmação obrigatória, exclusão, bloqueio de fatura paga, ocorrência excluída, filtros, mês, workspace, permissões e erros. As suítes anteriores continuam sendo executadas.

### Cenário em Chromium

API NestJS e PostgreSQL reais; JWT/JWKS de teste e autenticação Supabase simulados. Relógio do materializador fixado em 01/10/2026 para reproduzir o cenário. Fixtures próprias removidas ao terminar.

| Etapa                                                                                                                                     | Receitas | Despesas | Resultado |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | --------- |
| Salário 5000, Freelance 1000, Internet 120, Condomínio 650, Nubank Mercado 350 + Notebook 5/10 de 300, Inter Combustível 250, Energia 200 | 6000     | 1870     | 4130      |
| Excluir Energia                                                                                                                           | 6000     | 1670     | 4330      |
| Excluir Mercado                                                                                                                           | 6000     | 1320     | 4680      |

Após Mercado, Nubank mensal 300 e cartões 550. Limite Nubank usado 1800, incluindo as seis parcelas futuras/controladas do Notebook, sem o Mercado. Exclusão de Internet de novembro foi confirmada, seguida de rewind do cursor e materialização: não reapareceu, dezembro permaneceu. Baixa de outubro por 126,90 preservou previsto 120 e diferença 6,90. Busca, bloqueio de compra em fatura paga e troca de workspace também passaram.

Desktop 1440, tablet 768 e celular 390: sem overflow horizontal e sem erros no console; tabelas desktop e grade nos demais tamanhos verificadas em navegador e capturas inspecionadas.

- Visão inicial: [desktop](screenshots/transactions-view-desktop.png), [tablet](screenshots/transactions-view-tablet.png), [mobile](screenshots/transactions-view-mobile.png).
- Após exclusões: [desktop](screenshots/transactions-view-deleted-desktop.png), [tablet](screenshots/transactions-view-deleted-tablet.png), [mobile](screenshots/transactions-view-deleted-mobile.png).

## Roadmap

FIN-9 foi ajustada para Reorganização de Lançamentos e Exclusão Definitiva. O conteúdo integral do antigo Dashboard foi preservado na FIN-10, em Backlog. Não houve implementação de Dashboard nem alteração das outras tasks.

## Resultado final da suíte

Validação concluída em 03/10/2026:

| Comando              | Resultado                                                 |
| -------------------- | --------------------------------------------------------- |
| `pnpm lint`          | Aprovado                                                  |
| `pnpm build`         | Aprovado                                                  |
| `pnpm test`          | 47 testes API e 71 Web aprovados                          |
| `pnpm format:check`  | Aprovado                                                  |
| `pnpm db:validate`   | Schema válido                                             |
| `pnpm test:database` | 65 testes PostgreSQL aprovados                            |
| `pnpm db:test`       | Integridade dos 13 modelos aprovada; fixtures em rollback |

A regressão inclui Auth/Workspace, contas/categorias, lançamentos, cartões/faturas, parcelamentos novos/retroativos e recorrências. Na retomada, PostgreSQL estava parado; foi iniciado com `docker compose up -d --wait postgres`, migrations conferidas sem pendências e a suíte de banco repetida com sucesso. Não houve reset. Permanecem avisos não bloqueantes já existentes de bundle Web acima de 500 kB e depreciação do driver pg via Prisma. Não há pendência funcional desta entrega nem commit automático.
