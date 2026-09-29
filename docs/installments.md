# Parcelamentos — Task 07

Parcelamentos comuns (INCOME ou EXPENSE) e compras parceladas no cartão usam o InstallmentGroup existente. Um novo parcelamento gera N Transactions, numeradas de 1 a N. Um parcelamento em andamento gera somente startingInstallment..N, preservando a numeração original. O grupo guarda valor total, quantidade, descrição, data original e vínculos; o tipo é obtido das parcelas imutáveis. Não houve alteração de schema ou migration.

Não são recorrências: todo grupo tem começo e fim definidos. Não há juros, antecipação, refund, chargeback, renegociação ou parcelamento de fatura.

## Contratos REST

JWT, Workspace Context e membership são obrigatórios em todas as rotas. VIEWER pode consultar/pré-visualizar, mas não criar ou cancelar. Cada referência e lookup é limitado ao workspace; cartão/fatura também são comparados entre si.

| Método | Rota                                     | Função                                                                                    |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/installments/preview`                  | Prévia comum: totalAmount, installmentCount, firstDueDate. Sem gravação.                  |
| POST   | `/installments`                          | Cria grupo comum e todas as parcelas; HTTP 201.                                           |
| POST   | `/credit-cards/:id/installments/preview` | Prévia pelo cartão: totalAmount, installmentCount, transactionDate; limites antes/depois. |
| POST   | `/credit-cards/:id/installments`         | Cria compra parcelada com faturas; HTTP 201.                                              |
| GET    | `/installment-groups/:id`                | Grupo, tipo, origem e todas as parcelas/status/datas/faturas.                             |
| POST   | `/installment-groups/:id/cancel`         | Parcelamento comum: scope ONE ou FROM e fromInstallmentNumber.                            |
| DELETE | `/installment-groups/:id`                | Cancela compra parcelada no cartão inteira, se nenhuma parcela paga.                      |

Exemplo comum:

```json
{
  "description": "Curso",
  "type": "EXPENSE",
  "totalAmount": "1000.00",
  "installmentCount": 3,
  "transactionDate": "2026-09-29",
  "firstDueDate": "2026-10-10",
  "accountId": "UUID",
  "categoryId": "UUID",
  "notes": null
}
```

No cartão, omitir type, accountId e firstDueDate. No retroativo, informar firstInvoiceMonth (YYYY-MM); transactionDate é opcional/histórica. Informar description, totalAmount, installmentCount, transactionDate, categoryId e notes opcional. O cartão vem da rota; faturas/competências vêm do backend. Campos desconhecidos ou protegidos são rejeitados.

## Divisão exata

`installment-plan.ts` centraliza os algoritmos. São aceitas 1–120 parcelas. Total positivo com no máximo duas casas, sem float; o contrato recomendado é string decimal.

1. Converter string monetária para centavos BigInt.
2. `base = totalCentavos / N`, com divisão inteira.
3. `restante = totalCentavos % N`.
4. As primeiras N−1 parcelas recebem base; a última recebe base + restante.

Exemplos: 100/3 → 33.33, 33.33, 33.34; 10/6 → cinco parcelas de 1.66 e uma de 1.70; 0.01/1 → 0.01. Se totalCentavos < N, rejeitar: não há parcelas de valor zero. A soma do plano original é exatamente totalAmount, inclusive na faixa máxima de Decimal(19,2). No retroativo, dividir primeiro o plano original e só então selecionar as parcelas controladas; sua soma é controlledAmount.

expectedAmount de cada parcela preserva o plano original. No comum, amount começa null e pode diferir na baixa, conforme FIN-5; isso não altera o total contratado nem a soma prevista. No cartão, expectedAmount e amount começam iguais à parcela, conforme FIN-6. Cancelamento mantém os valores e a história; os totais ativos deixam de contar as parcelas canceladas, enquanto totalAmount continua registrando o contrato original.

## Datas comuns

A primeira parcela **controlada** usa firstDueDate, mesmo quando seu número original é maior que 1. Todas as seguintes calculam o mês a partir do **mês original mais o índice**, mantendo o dia-base original e limitando-o ao último dia válido. Não se usa a data já ajustada de fevereiro como base para março.

31/01/2027 → 28/02/2027 → 31/03/2027 → 30/04/2027. Em 2028, fevereiro recebe 29. Competência é o primeiro dia do mês do vencimento; transactionDate permanece a data original em todas as parcelas. Datas civis são strings YYYY-MM-DD, sem deslocamento de timezone.

Conta deve estar ativa no workspace e categoria ativa/compatível com INCOME ou EXPENSE. Autoria é o User autenticado. Responsável não é acrescentado nesta interface.

## Cartão e faturas

Em novos parcelamentos (startingInstallment = 1), a primeira competência é determinada por `purchaseCalendar` da FIN-6. No retroativo, firstInvoiceMonth define explicitamente a primeira competência controlada, sem inferência pela data histórica. Cada parcela seguinte avança exatamente um mês de competência, **sem simular uma nova compra**. O vencimento usa dueDay original ajustado ao mês; a virada da fatura corresponde à ocorrência de closingDay imediatamente anterior ou igual ao vencimento. Faturas existentes preservam suas datas persistidas.

Virada 25, vencimento 10, compra 29/09/2026: primeira parcela em novembro/2026, segunda em dezembro, terceira em janeiro/2027. Dez parcelas terminam em agosto/2027. O calendário continua seguindo o esclarecimento aprovado na FIN-6 sobre dezembro e meses curtos.

Cada competência é criada/reutilizada por upsert na chave única cartão/referenceMonth. Cada Transaction tem accountId null, type EXPENSE, status PENDING, invoiceId, creditCardId, installmentGroupId e installmentNumber. Descrição é retornada pelo backend como “Notebook 1/10”; dados estruturados acompanham a listagem geral e o detalhe do grupo.

Fatura já paga em qualquer posição bloqueia **toda a criação**, com rollback inclusive de grupo, parcelas e faturas novas criadas antes dela.

## Limite e pagamento

Validar disponível >= controlledAmount sob o mesmo lock de cartão da FIN-6, antes de gerar parcelas. Em um grupo novo, controlledAmount = totalAmount; no retroativo, só o valor materializado compromete o limite. Como todas as Transactions já existem em faturas futuras, a soma de compras não canceladas em faturas não pagas compromete o valor total imediatamente.

R$1.000 em 10x num cartão de R$5.000: utilizado1000/disponível4000. Pagar a primeira fatura realiza só sua parcela de100; utilizado900/disponível4100. As demais permanecem PENDING. Cada mês recebe somente sua parcela no resumo, nunca o total do grupo.

O pagamento da fatura continua registrando paymentAccountId/paidAmount e marcando suas compras PAID atomicamente. Não cria outra EXPENSE. A conta bancária não é atribuída às parcelas de cartão. Reabertura da fatura permanece fora do escopo.

## Cancelamento e edição

Comum:

- Cancelar esta parcela: somente a selecionada pendente (inclusive atrasada na leitura).
- Cancelar esta e as próximas: selecionada deve estar pendente; cancela dela em diante somente pendentes, preservando todas as pagas, inclusive posteriores.
- Rotas bancárias existentes permitem baixa/reabertura individual. DELETE de uma Transaction comum continua disponível para cancelamento individual; pago exige reabertura antes.

Cartão:

- Cancelamento somente da compra parcelada completa, pelo grupo.
- Nenhuma parcela pode estar PAID ou em fatura PAID.
- Todas passam a CANCELLED, saem das faturas/resumo e liberam limite, sem exclusão física.
- Cancelamento isolado pelas rotas de compra simples/bancária é bloqueado.
- Após qualquer parcela paga, bloquear cancelamento completo; estornos/refunds são futuros.

Nenhuma edição de grupo após criação. PATCH de Transaction parcelada também é bloqueado, incluindo campos descritivos nesta versão, evitando divergência entre grupo e títulos. Na baixa comum é possível informar amount realizado diferente; expectedAmount, total e calendário permanecem intactos. Reabertura comum preserva amount, como antes.

## Atomicidade, concorrência e retry

Criações são transações Prisma/PostgreSQL: grupo e todas as parcelas controladas (mais faturas, no cartão) ou nada. Unicidade `(installmentGroupId, installmentNumber)` protege a numeração; o serviço gera startingInstallment..installmentCount.

Mutações usam o lock consultivo de categoria/workspace; compras e cancelamentos de cartão também usam o lock da linha CreditCard compartilhado com FIN-6. Isso serializa limite, baixa de fatura e cancelamento completo. Pagamentos comuns e cancelamentos futuros compartilham o lock de workspace, impedindo que uma parcela paga seja cancelada em corrida. Conta é validada sob FOR SHARE. Consultas de grupo usam snapshot RepeatableRead. Leituras de várias faturas na mesma transação agora são sequenciais, evitando chamadas paralelas na mesma conexão do driver PostgreSQL.

**Limitação de idempotência HTTP:** não existe chave de idempotência persistida no projeto. Uma nova requisição POST depois de uma resposta perdida pode criar outro grupo completo, caso ainda haja limite. Não há retry automático da criação; a UI bloqueia duplo envio durante processamento. Antes de repetir uma criação após falha de rede, conferir a lista. Atomicidade e constraints impedem grupos parciais, mas não deduplicam intenções de compra distintas com payload igual. Nenhuma arquitetura de idempotência adicional foi introduzida nesta task, conforme a alternativa mínima permitida na especificação.

## Web

Nos formulários de receita/despesa e Nova compra há seletor Pagamento: À vista/Parcelado. Parcelado abre formulário de valor total, quantidade e datas; a prévia vem da API, mostra todas as parcelas e é obrigatória antes de salvar. Alterar campos invalida a prévia. No cartão também mostra limite disponível antes/depois e bloqueia envio quando a previsão é negativa; validação transacional do backend é a autoridade final.

`/app/installment-groups/:id` mostra todas as parcelas, status, vencimentos, competências e links de fatura. Comum permite baixa e cancelamento individual/futuro; cartão oferece cancelamento completo apenas quando não há parcela paga. Lista geral e fatura exibem “1/N” e link para o grupo. Ações bancárias não são oferecidas para parcelas de cartão; ação de editar não aparece para parcelas comuns.

Troca de workspace remonta páginas/formulários e descarta prévias e dados antigos. Sem novo pacote, dependência ou migration.

## Validação

```bash
pnpm lint
pnpm build
pnpm test
pnpm format:check
pnpm db:validate
pnpm test:database
pnpm db:test
```

Testes unitários cobrem divisão exata, resíduos, zero impossível, 1–120 parcelas, valores grandes, meses curtos/bissextos, ano novo, virada e competências consecutivas. Integração cobre EXPENSE/INCOME, 120 parcelas, vínculos/tenant, baixa individual, cancelamento futuro preservando pagas, rollback no meio da geração, limite integral, pagamento progressivo, concorrência e proteção de cartão/fatura. Testes Web cobrem alternância, prévia e invalidação, arredondamento, criação, identificação, detalhe, cancelamento, limite e troca de workspace.

Cenários Chromium executados com API NestJS/PostgreSQL reais e identidade JWT/JWKS simulada:

- Curso R$1.000/3x: 10/10 R$333,33; 10/11 R$333,33; 10/12 R$333,34. Soma R$1.000.
- Notebook R$1.000/10x em 29/09/2026: novembro/2026 até agosto/2027, R$100 cada. Limite5000 → disponível4000. Pagamento de novembro → utilizado900/disponível4100; resumo novembro previsto100/realizado100, sem duplicação; nove parcelas futuras pendentes.
- Cenários em workspaces separados para conferir o resumo do cartão isoladamente. Troca de contexto, bloqueio de cancelamento isolado e bloqueio após baixa também verificados.
- Desktop1440, tablet768 e celular390, sem erros de console. Não representa autenticação manual com credenciais pessoais Supabase.

Capturas:

- [Comum — desktop](screenshots/installments-common-desktop.png)
- [Comum — tablet](screenshots/installments-common-tablet.png)
- [Comum — celular](screenshots/installments-common-mobile.png)
- [Cartão — desktop](screenshots/installments-card-desktop.png)
- [Cartão — tablet](screenshots/installments-card-tablet.png)
- [Cartão — celular](screenshots/installments-card-mobile.png)

Avisos não bloqueantes: bundle Web acima de 500 kB e depreciação do `pg` sobre consultas simultâneas na mesma conexão. O rastreamento aponta chamadas via `@prisma/adapter-pg`/runtime Prisma; a suíte PostgreSQL passa integralmente, mas a compatibilidade deve ser revista antes de atualizar para pg 9. Não houve commit automático. FIN-8/FIN-9 não foram implementadas ou alteradas.

## Complemento FIN-7 — valor individual e controle retroativo

Os mesmos endpoints aceitam dois modos; strings monetárias continuam preferidas:

- `amountMode: "TOTAL"`: exige `totalAmount`, proíbe `installmentAmount`. O valor é o total **original**, não o restante. Mantém divisão em centavos e resíduo na última parcela original.
- `amountMode: "INSTALLMENT"`: exige `installmentAmount`, proíbe `totalAmount`. O backend multiplica centavos BigInt pela quantidade original. Como o produto é divisível pela quantidade, todas as parcelas ficam exatamente iguais, sem ajuste residual. 333.33 × 3 = 999.99, nunca 1000.00. Produto acima de Decimal(19,2) é rejeitado antes da gravação.
- Ausência de `amountMode` equivale a TOTAL, preservando clientes anteriores. `startingInstallment` tem padrão 1; deve ser inteiro entre 1 e installmentCount, que permanece entre 1 e 120.
- Payload com ambos os valores, valor ausente no modo escolhido, campos desconhecidos, zero/negativo ou frações de centavo é rejeitado.

Exemplo comum (POST /installments):

```json
{
  "description": "Empréstimo pessoal",
  "type": "EXPENSE",
  "amountMode": "INSTALLMENT",
  "installmentAmount": "500.00",
  "installmentCount": 12,
  "startingInstallment": 7,
  "transactionDate": "2026-09-29",
  "firstDueDate": "2026-10-15",
  "accountId": "UUID",
  "categoryId": "UUID"
}
```

Gera somente 7/12 em 15/10/2026 até 12/12 em 15/03/2027. `firstDueDate` é o primeiro vencimento **controlado**; não avança seis meses por começar em 7. O dia-base continua preservado em meses curtos. A prévia comum recebe apenas os campos de valor, quantidade, startingInstallment e firstDueDate.

Exemplo cartão (POST /credit-cards/:id/installments):

```json
{
  "description": "Notebook",
  "amountMode": "INSTALLMENT",
  "installmentAmount": "300.00",
  "installmentCount": 10,
  "startingInstallment": 5,
  "firstInvoiceMonth": "2026-10",
  "categoryId": "UUID"
}
```

Gera 5/10 em outubro/2026 até 10/10 em março/2027. A prévia do cartão recebe os campos de valor, quantidade, startingInstallment e firstInvoiceMonth (ou transactionDate no novo). Para startingInstallment = 1, transactionDate é obrigatória e firstInvoiceMonth é proibida; usa o calendário FIN-6. Para startingInstallment > 1, firstInvoiceMonth é obrigatória e transactionDate opcional não influencia a fatura. A UI não pede data de compra no retroativo.

**Data técnica no retroativo do cartão:** como purchaseDate e transactionDate existentes são obrigatórios no schema, quando a API não recebe data histórica, usa o primeiro dia de firstInvoiceMonth. Essa data representa o início do controle, não uma inferência da compra original. Se a data histórica for fornecida, será preservada. Competência, vencimento e limite não dependem desse preenchimento.

Não há migration, reset nem campos redundantes. `InstallmentGroup.totalAmount` e `installmentCount` guardam total e quantidade originais. A criação atômica garante uma sequência contínua startingInstallment..installmentCount. Como parcelas não são excluídas fisicamente e expectedAmount/numeração não são editáveis, o detalhe deriva com segurança:

| Campo                      | Significado                                                |
| -------------------------- | ---------------------------------------------------------- |
| totalAmount                | Valor original, incluindo parcelas anteriores ao controle  |
| installmentCount           | Quantidade original                                        |
| startingInstallment        | Menor installmentNumber persistido                         |
| previousInstallmentCount   | startingInstallment − 1                                    |
| controlledInstallmentCount | Quantidade materializada, incluindo pagas/canceladas       |
| controlledAmount           | Soma de expectedAmount de todas as parcelas materializadas |

A prévia retorna os mesmos campos calculados do plano. `controlledAmount` é o **valor controlado inicialmente**, não um saldo dinâmico em aberto: não diminui com baixas, diferenças de valor realizado ou cancelamentos. O detalhe usa esse rótulo explicitamente. O modo de entrada não precisa ser persistido: o plano e os valores originais estão preservados.

Parcelas anteriores não existem no banco, não são tratadas como pagas, não entram no resumo, não geram faturas e não participam de cancelamento. Upsert cria/reutiliza somente as competências materializadas. Pagamento, status, cancelamento, resumo e isolamento seguem as regras anteriores sem exceções. Fatura controlada já paga continua bloqueando a criação inteira com rollback.

No exemplo de cartão, original R$3.000 e controlado R$1.800: somente R$1.800 compromete limite. Um cartão com R$2.000 disponível aceita a operação. Após pagar a primeira fatura de R$300, o compromisso cai para R$1.500. Não há reconstrução do limite histórico.

No modo TOTAL, 100/3 iniciado em 3 gera somente 3/3 de 33.34. Não se divide 100 novamente pela quantidade restante. No modo INSTALLMENT, 10×300 iniciado em 5 gera seis parcelas de 300 com numeração 5–10.

### Validação do complemento

Cobertura adicionada: contratos ambíguos/ausentes, limites de numeração e overflow monetário, multiplicação individual exata, resíduo retroativo, calendário manual e histórico independente, ausência de parcelas/faturas anteriores, reutilização de fatura, resumo apenas materializado, baixa e cancelamento com metadados preservados, rollback em fatura paga e isolamento por workspace. A interface cobre modos, campos condicionais, prévia inválida após mudanças, payloads, numeração original e detalhe após cancelamento.

Os três cenários foram executados via Chromium com API/PostgreSQL reais e JWT/JWKS simulado:

- A: valor individual 100, quantidade 5, novo → cinco parcelas de 100, original/controlado 500.
- B: Notebook 10×300, início 5, primeira fatura outubro/2026 → original 3000, quatro anteriores, seis controladas, valor 1800, numeração 5–10 e faturas outubro/2026–março/2027. Conferência direta no banco confirmou exatamente seis Transactions e seis faturas, nenhuma anterior.
- C: total 100, quantidade 3, início 3 → uma Transaction 3/3 de 33.34, mantendo original 100.

Capturas da prévia e do detalhe em desktop (1440), tablet (768) e celular (390), sem overflow horizontal ou erros no console:

- [Prévia desktop](screenshots/installments-retro-preview-desktop.png), [tablet](screenshots/installments-retro-preview-tablet.png), [celular](screenshots/installments-retro-preview-mobile.png).
- [Detalhe desktop](screenshots/installments-retro-detail-desktop.png), [tablet](screenshots/installments-retro-detail-tablet.png), [celular](screenshots/installments-retro-detail-mobile.png).

A limitação anterior de idempotência HTTP permanece. Nenhuma recorrência ou mudança na FIN-8 foi incluída.

Resultado final do complemento: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm format:check`, `pnpm db:validate`, `pnpm test:database` e `pnpm db:test` aprovados. Foram 40 testes API/calendário, 55 Web e 47 de integração PostgreSQL, além do script de integridade dos 11 modelos. A regressão Chromium dos cenários anteriores (comum novo, cartão novo e pagamento de fatura) também passou nos três viewports, sem erros de console. Permanecem os avisos não bloqueantes de bundle e driver descritos acima.
