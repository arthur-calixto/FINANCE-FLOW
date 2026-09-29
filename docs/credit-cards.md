# Cartões, faturas e compras simples — Task 06

Fluxo: cadastrar cartão → compra à vista → fatura determinada pelo backend → pagamento integral usando uma conta. Sem parcelamentos, recorrências, juros, rotativo, pagamentos parciais ou dashboard. A arquitetura REST e o isolamento por workspace são preservados.

## Virada e calendário

`closingDay` é o **primeiro dia em que uma compra já pertence ao ciclo seguinte**. A interface usa “Dia da virada da fatura”. O backend centraliza a regra em `card-calendar.ts`; a Web consulta uma previsão, sem implementar outro algoritmo.

1. Ajustar a virada ao último dia válido do mês, se necessário.
2. Escolher a primeira virada **estritamente posterior** à data da compra. Compra na própria virada já usa a virada do mês seguinte.
3. Escolher a primeira ocorrência do dia de vencimento **a partir dessa virada**, inclusive. Se o dia ajustado de vencimento no mês da virada for anterior à virada, usar o mês seguinte.
4. A competência é o primeiro dia do mês do vencimento.

| Virada / vencimento | Compra     | Virada que encerra o ciclo | Fatura / vencimento    |
| ------------------- | ---------- | -------------------------- | ---------------------- |
| 25 / 10             | 24/09/2026 | 25/09/2026                 | Outubro / 10/10/2026   |
| 25 / 10             | 25/09/2026 | 25/10/2026                 | Novembro / 10/11/2026  |
| 25 / 10             | 26/09/2026 | 25/10/2026                 | Novembro / 10/11/2026  |
| 1 / 10              | 30/09/2026 | 01/10/2026                 | Outubro / 10/10/2026   |
| 1 / 10              | 01/10/2026 | 01/11/2026                 | Novembro / 10/11/2026  |
| 25 / 10             | 25/12/2026 | 25/01/2027                 | Fevereiro / 10/02/2027 |
| 25 / 31             | 25/12/2026 | 25/01/2027                 | Janeiro / 31/01/2027   |

**Esclarecimento aprovado pelo usuário:** o exemplo genérico “após virada em dezembro → janeiro” dependia do dia de vencimento. Para 25/10, a competência correta após a virada de dezembro é fevereiro. Aplica-se a regra geral acima, sem exceção artificial em dezembro.

Dias entre 1 e 31 são limitados à quantidade de dias do mês. Fevereiro/2027 tem 28 dias; fevereiro/2028 tem 29. Abril com virada 31 vira no dia 30. O cálculo usa calendário gregoriano, incluindo a regra de séculos dos anos bissextos. Datas civis não passam por conversão de timezone; o dia operacional usa America/Sao_Paulo.

## Cartão e limite

Cadastro: nome, limite não negativo, virada e vencimento entre 1 e 31. Exclusão lógica com isActive; PATCH permite reativar. Desativar bloqueia novas compras, mas preserva consulta, cancelamentos permitidos e pagamento de faturas existentes.

Limite utilizado = soma de amount das compras não canceladas vinculadas a faturas não pagas daquele cartão, **em todas as competências**, incluindo futuras. Limite disponível = limite total − utilizado. Não se usa apenas a fatura atual. A consulta já considera todas as Transactions vinculadas, permitindo evolução posterior para parcelas distribuídas entre faturas; geração de parcelas não faz parte desta task.

Uma nova compra não pode exceder o disponível; redução de limite abaixo do comprometido é bloqueada. Decimais são tratados com PostgreSQL NUMERIC e Decimal, sem aritmética monetária em Number. Zero é permitido para limite, mas não para compra ou pagamento.

Dias de virada/vencimento podem ser editados antes da primeira fatura. Depois disso, sua alteração é bloqueada nesta versão para não reinterpretar ciclos históricos ou gerar calendários conflitantes. Nome, limite e isActive continuam editáveis. Uma mudança de calendário com vigência temporal poderá ser adicionada posteriormente.

## Compra e fatura automática

A compra exige cartão ativo e categoria EXPENSE ativa no workspace. Recebe descrição, amount positivo, transactionDate, categoryId e notes opcional. Produz Transaction EXPENSE/PENDING, expectedAmount = amount, accountId = null, createdBy = usuário autenticado. Backend determina creditCardId, invoiceId, competenceDate e dueDate. Campos extras de status, conta, fatura, parcela e competência são rejeitados.

A fatura é criada por upsert na chave única `(creditCardId, referenceMonth)`. Datas da fatura são persistidas e reutilizadas; sua competência corresponde ao vencimento. O service mantém igualdade de cartão e workspace entre compra e fatura. Não se adicionam compras retroativas a uma fatura já paga.

Compra continua pendente até a liquidação da fatura. Não há baixa individual pelas rotas bancárias da Task 05. A lista geral mostra cartão, competência e link da fatura, sem oferecer Pagar, Reabrir ou Editar como se fosse lançamento bancário.

Cancelamento ocorre pela rota do cartão, antes de pagar a fatura. Persiste CANCELLED; remove imediatamente a compra do total, do limite comprometido e do resumo econômico, mas mantém o histórico. Fatura paga bloqueia cancelamento de suas compras.

## Fatura atual e estados

Fatura atual é a obrigação não paga com o vencimento mais antigo, priorizando atrasadas e desconsiderando faturas sem compras válidas. Quando não há atrasadas, representa a próxima obrigação. Pode coexistir com faturas futuras que já recebem compras após a virada. Se não houver obrigação, a UI informa isso sem criar uma fatura vazia.

Estados efetivos são calculados na leitura, sem job:

- PAID se liquidada;
- OVERDUE se não paga e dueDate < hoje;
- CLOSED se hoje >= closingDate, sem atraso;
- OPEN antes da virada.

O estado persistido de faturas não pagas permanece OPEN, e PAID é gravado no pagamento. No vencimento, ainda não é atrasada. Consulta não modifica o banco. Faturas abertas também podem ser integralmente antecipadas; após o pagamento ficam imutáveis, e novas compras para o mesmo ciclo são bloqueadas.

Total da fatura e quantidade de compras válidas derivam das Transactions não canceladas. O detalhe também exibe canceladas no histórico. Não há campo de total em aberto armazenado separadamente.

## Pagamento e representação de caixa

A compra é a despesa econômica. O pagamento integral da fatura é sua liquidação, **não outra EXPENSE nem uma transferência entre duas contas**.

O schema anterior tinha paidAt na fatura, mas não preservava a conta efetivamente usada nem o valor liquidado. A migration aditiva `20260929130000_invoice_payment` acrescenta:

- `CreditCardInvoice.paymentAccountId`, nullable, com FK composta `(workspaceId, paymentAccountId)` para Account;
- `CreditCardInvoice.paidAmount`, Decimal(19,2), nullable;
- índice por workspace/conta;
- CHECK de valor positivo e CHECK de pagamento completo quando qualquer novo campo estiver preenchido;
- relação reversa `Account.invoicePayments` no Prisma.

Nenhum dado é apagado, nenhum enum ou model adicional é criado. O CHECK permite registros legados com ambos os campos nulos; o service sempre grava os dois na nova liquidação. Antes de importar faturas antigas pagas, completar sua informação de caixa se ela for necessária para saldos.

POST pay exige conta ativa BRL do workspace e paidAt ISO com offset. amount é opcional: omitido usa o total calculado; informado deve coincidir exatamente. Pagamento parcial, total zero e segunda liquidação são rejeitados. A UI solicita dia e usa a convenção da Task 05 de 12:00:00-03:00; a API aceita horário explícito.

Na mesma transação:

1. validar cartão/fatura, conta, compras e total;
2. marcar compras válidas PAID com paidAt, preservando accountId null;
3. marcar fatura PAID e registrar paymentAccountId, paidAmount e paidAt.

Nenhuma segunda Transaction é criada. O resumo mensal inclui compras pela competência da fatura: antes do pagamento são previstas; depois são realizadas. Pagamento da fatura não é somado novamente. Canceladas permanecem excluídas.

Uma futura consulta de saldo de conta poderá subtrair `SUM(CreditCardInvoice.paidAmount)` das faturas PAID com paymentAccountId correspondente, juntamente com lançamentos bancários e demais movimentos apropriados. Assim R$350 de compra gera R$350 de despesa econômica e R$350 de saída de caixa, e não R$700 de despesa. `Account.initialBalance` não é alterado por pagamentos; permanece sendo saldo de partida. Saldo calculado não é introduzido nesta tarefa.

Reabertura de fatura paga fica fora desta entrega. Não existe endpoint para reverter parcialmente status de compras ou o registro de caixa.

## API

Todos os endpoints exigem JWT, `X-Workspace-Id` e membership. VIEWER consulta, mas não escreve. UUID de outro workspace não concede acesso; conta de pagamento cruzada é rejeitada. A comparação usa workspace e cartão em todos os acessos à fatura/compra.

| Método | Caminho                                                         | Função                                                       |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/credit-cards?includeInactive=true`                            | Lista com limites e fatura atual; por padrão somente ativos. |
| GET    | `/credit-cards/:id`                                             | Detalhe do cartão.                                           |
| POST   | `/credit-cards`                                                 | Cria cartão.                                                 |
| PATCH  | `/credit-cards/:id`                                             | Edita/reativa.                                               |
| DELETE | `/credit-cards/:id`                                             | Desativa.                                                    |
| GET    | `/credit-cards/:id/purchase-preview?transactionDate=YYYY-MM-DD` | Calendário determinado pelo backend, sem gravar.             |
| POST   | `/credit-cards/:id/purchases`                                   | Cria compra simples.                                         |
| DELETE | `/credit-cards/:id/purchases/:purchaseId`                       | Cancela compra não liquidada.                                |
| GET    | `/credit-cards/:id/invoices?month=YYYY-MM`                      | Até 24 faturas mais recentes, ou competência específica.     |
| GET    | `/credit-cards/:id/invoices/:invoiceId`                         | Fatura, total, compras e liquidação.                         |
| POST   | `/credit-cards/:id/invoices/:invoiceId/pay`                     | Pagamento integral.                                          |

A consulta mensal permite alcançar competências antigas além das 24 faturas iniciais. Transactions GET/lista/resumo incluem agora compras simples no cartão; PATCH/pay/reopen/DELETE bancários continuam limitados a lançamentos sem cartão/fatura. O cancelamento específico preserva as regras da fatura.

## Concorrência

Todas as mutações de cartão, compra e liquidação adquirem lock da linha CreditCard com workspace dentro de transação. Compras concorrentes, redução de limite, cancelamento e pagamento são serializados por cartão. A constraint única garante uma fatura por cartão/competência, e a segunda baixa encontra PAID e retorna 409.

O lock consultivo de categorias por workspace é adquirido antes do cartão, alinhado ao CategoriesService, para impedir alteração simultânea de tipo enquanto uma compra é criada. A conta de pagamento fica sob FOR SHARE durante a validação e gravação, impedindo desativação concorrente que atravesse a operação. Consultas compostas usam snapshot RepeatableRead para manter total, status e limite coerentes entre queries.

## Web e validação

Rotas `/app/credit-cards`, `/app/credit-cards/:cardId/invoices` e `/app/credit-cards/:cardId/invoices/:invoiceId`. A UI reutiliza Button, Card, Dialog, formulários, loading, erros e estados vazios. Mostra fatura atual, histórico, limite e previsão pelo backend; cancelamento pede confirmação. Troca de workspace descarta dados, limites, faturas e formulários, abortando requisições antigas.

Testes de calendário cobrem antes/no dia/depois da virada, virada 1 e 31, fevereiro comum/bissexto, abril, meses de 31 dias, séculos e mudança de ano. Integração PostgreSQL cobre CRUD, limites, inativos, vínculos, criação/reuso concorrente, cancelamento, pagamentos simultâneos, conta de liquidação, cross-tenant, VIEWER e resumo sem dupla contagem. Testes Web cobrem cadastro, edição, desativação/reativação, compra com previsão, atual/futura, detalhe, cancelamento, pagamento, erro de limite e troca de workspace.

```bash
pnpm lint
pnpm build
pnpm test
pnpm format:check
pnpm db:validate
pnpm test:database
pnpm db:test
```

### Cenário validado em navegador

Nubank Mastercard, limite R$5.000, virada 25, vencimento 10. Supermercado de R$350 em 24/09/2026 foi associado a outubro (10/10), e Combustível de R$200 em 25/09 foi associado a novembro (10/11). Limite utilizado R$550 e disponível R$4.450.

Pagamento integral de outubro usando Conta corrente registrou paidAmount 350.00/paymentAccountId na fatura e marcou somente a compra de outubro PAID. Novembro permaneceu pendente; limite utilizado caiu para R$200 e disponível subiu para R$4.800. Resumo de outubro: expected 350.00 e realized 350.00, sem criar outra Transaction. A compra aparece na lista geral com cartão e link da fatura, sem ação de baixa bancária.

Também foram verificados histórico/fatura futura, cancelamento de novembro liberando limite e troca de workspace sem cartões anteriores. Chromium em 1440, 768 e 390 px, sem erros de console. Identidade simulada por JWT/JWKS de teste; API NestJS e PostgreSQL reais, com fixtures próprias removidas ao final. Não foi usada conta pessoal Supabase para essa validação.

- [Cartões — desktop](screenshots/credit-cards-desktop.png)
- [Cartões — tablet](screenshots/credit-cards-tablet.png)
- [Cartões — celular](screenshots/credit-cards-mobile.png)
- [Fatura — desktop](screenshots/invoice-desktop.png)
- [Fatura — tablet](screenshots/invoice-tablet.png)
- [Fatura — celular](screenshots/invoice-mobile.png)

Limitações deliberadas: sem reabertura de fatura, sem edição de compra (cancelar e registrar novamente antes do pagamento) e sem mudança de calendário após a primeira fatura. Bundle Web mantém aviso não bloqueante acima de 500 kB. Não há commit automático.

## Evolução na Task 07

Compras parceladas usam as mesmas faturas, locks, pagamento e cálculo de limite. Todas as parcelas futuras são geradas juntas; cancelamento passa a ser por grupo e somente antes de qualquer parcela paga. A rota de cancelamento de compra simples continua rejeitando parcelas. Veja [parcelamentos](installments.md).
