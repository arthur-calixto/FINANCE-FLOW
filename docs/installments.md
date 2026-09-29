# Parcelamentos — Task 07

Parcelamentos comuns (INCOME ou EXPENSE) e compras parceladas no cartão usam o InstallmentGroup existente. Uma criação gera exatamente N Transactions, numeradas de 1 a N. O grupo guarda valor total, quantidade, descrição, data original e vínculos; o tipo é obtido das parcelas imutáveis. Não houve alteração de schema ou migration.

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

No cartão, omitir type, accountId e firstDueDate. Informar description, totalAmount, installmentCount, transactionDate, categoryId e notes opcional. O cartão vem da rota; faturas/competências vêm do backend. Campos desconhecidos ou protegidos são rejeitados.

## Divisão exata

`installment-plan.ts` centraliza os algoritmos. São aceitas 1–120 parcelas. Total positivo com no máximo duas casas, sem float; o contrato recomendado é string decimal.

1. Converter string monetária para centavos BigInt.
2. `base = totalCentavos / N`, com divisão inteira.
3. `restante = totalCentavos % N`.
4. As primeiras N−1 parcelas recebem base; a última recebe base + restante.

Exemplos: 100/3 → 33.33, 33.33, 33.34; 10/6 → cinco parcelas de 1.66 e uma de 1.70; 0.01/1 → 0.01. Se totalCentavos < N, rejeitar: não há parcelas de valor zero. Soma dos valores previstos gerados é exatamente totalAmount, inclusive na faixa máxima de Decimal(19,2).

expectedAmount de cada parcela preserva o plano original. No comum, amount começa null e pode diferir na baixa, conforme FIN-5; isso não altera o total contratado nem a soma prevista. No cartão, expectedAmount e amount começam iguais à parcela, conforme FIN-6. Cancelamento mantém os valores e a história; os totais ativos deixam de contar as parcelas canceladas, enquanto totalAmount continua registrando o contrato original.

## Datas comuns

A primeira parcela usa firstDueDate. Todas as seguintes calculam o mês a partir do **mês original mais o índice**, mantendo o dia-base original e limitando-o ao último dia válido. Não se usa a data já ajustada de fevereiro como base para março.

31/01/2027 → 28/02/2027 → 31/03/2027 → 30/04/2027. Em 2028, fevereiro recebe 29. Competência é o primeiro dia do mês do vencimento; transactionDate permanece a data original em todas as parcelas. Datas civis são strings YYYY-MM-DD, sem deslocamento de timezone.

Conta deve estar ativa no workspace e categoria ativa/compatível com INCOME ou EXPENSE. Autoria é o User autenticado. Responsável não é acrescentado nesta interface.

## Cartão e faturas

A primeira competência é determinada por `purchaseCalendar` da FIN-6. Cada parcela seguinte avança exatamente um mês de competência, **sem simular uma nova compra**. O vencimento usa dueDay original ajustado ao mês; a virada da fatura corresponde à ocorrência de closingDay imediatamente anterior ou igual ao vencimento. Faturas existentes preservam suas datas persistidas.

Virada 25, vencimento 10, compra 29/09/2026: primeira parcela em novembro/2026, segunda em dezembro, terceira em janeiro/2027. Dez parcelas terminam em agosto/2027. O calendário continua seguindo o esclarecimento aprovado na FIN-6 sobre dezembro e meses curtos.

Cada competência é criada/reutilizada por upsert na chave única cartão/referenceMonth. Cada Transaction tem accountId null, type EXPENSE, status PENDING, invoiceId, creditCardId, installmentGroupId e installmentNumber. Descrição é retornada pelo backend como “Notebook 1/10”; dados estruturados acompanham a listagem geral e o detalhe do grupo.

Fatura já paga em qualquer posição bloqueia **toda a criação**, com rollback inclusive de grupo, parcelas e faturas novas criadas antes dela.

## Limite e pagamento

Validar disponível >= totalAmount sob o mesmo lock de cartão da FIN-6, antes de gerar parcelas. Como todas as Transactions já existem em faturas futuras, a soma de compras não canceladas em faturas não pagas compromete o valor total imediatamente.

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

Criações são transações Prisma/PostgreSQL: grupo e N parcelas (mais faturas, no cartão) ou nada. Unicidade `(installmentGroupId, installmentNumber)` protege a numeração; o serviço sempre gera 1..installmentCount.

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
