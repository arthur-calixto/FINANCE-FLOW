# Lançamentos simples — Task 05

A rota `/app/transactions` oferece receitas e despesas avulsas, consulta mensal, filtros, edição, baixa, reabertura e cancelamento. Reutiliza o App Shell e os componentes de formulário, modal, loading, erro e estado vazio. Não há cartões, faturas, parcelamentos, recorrências, transferências ou dashboard nesta entrega. Nenhum schema ou migration foi alterado.

## Contrato REST

Todos os endpoints exigem JWT válido, `X-Workspace-Id` e membership. OWNER, ADMIN e MEMBER escrevem; VIEWER apenas consulta. Todas as operações e referências são limitadas ao workspace. Conhecer o UUID de outro tenant não concede acesso (404). Selecionar workspace sem membership retorna 403.

| Método | Rota                                  | Resultado                                         |
| ------ | ------------------------------------- | ------------------------------------------------- |
| GET    | `/transactions`                       | Lista por vencimento e ID, com filtros opcionais. |
| GET    | `/transactions/summary?month=2026-10` | Resumo da competência; mês obrigatório.           |
| GET    | `/transactions/:id`                   | Detalhe, incluindo cancelados.                    |
| POST   | `/transactions`                       | Cria PENDING; HTTP 201.                           |
| PATCH  | `/transactions/:id`                   | Edita pendente/atrasado; HTTP 200.                |
| DELETE | `/transactions/:id`                   | Cancela, sem exclusão física; HTTP 200.           |
| POST   | `/transactions/:id/pay`               | Paga ou recebe; HTTP 200.                         |
| POST   | `/transactions/:id/reopen`            | Reabre pago; body vazio; HTTP 200.                |

Filtros: `month=YYYY-MM`, `type`, `status`, `accountId`, `categoryId` e `search` por descrição (sem distinguir maiúsculas). Filtros são combinados por AND. Sem mês, a API lista todos os lançamentos simples do workspace. A Web sempre informa mês, possui filtros de tipo/status/conta/categoria e navegação mensal. Cancelados ficam consultáveis e identificados; não entram nos totais.

Os campos de cartão, fatura, parcelamento e recorrência não são aceitos. As consultas deste módulo excluem registros que utilizem esses vínculos, preservando os fluxos futuros.

## Criação e edição

```json
{
  "description": "Energia",
  "type": "EXPENSE",
  "expectedAmount": "200.00",
  "transactionDate": "2026-09-29",
  "dueDate": "2026-10-10",
  "accountId": "UUID da conta",
  "categoryId": "UUID da categoria",
  "notes": null
}
```

`workspaceId` vem do contexto, `createdBy` do User autenticado e `status` nasce PENDING. `competenceDate` é calculada. Enviar qualquer um desses campos, IDs gerados ou campos desconhecidos no body resulta em 400; não são utilizados valores arbitrários do cliente.

Conta e categoria são obrigatórias para novos lançamentos simples. Devem ser ativas e do mesmo workspace. A categoria deve ter o mesmo tipo INCOME/EXPENSE. `ownerMemberId` é opcional e deve identificar membership do mesmo tenant. A UI não acrescenta seleção de responsável nesta tarefa; PATCH sem o campo preserva o responsável existente.

Históricos podem manter conta/categoria posteriormente inativadas e continuar sendo editados ou baixados. Trocar o vínculo exige um recurso ativo. O seletor preserva o vínculo inativo atual e filtra os demais. Mudar o tipo exige categoria compatível. O CategoriesService bloqueia mudanças de tipo que tornariam lançamentos existentes incompatíveis, inclusive históricos cancelados.

PATCH é parcial e exige ao menos um campo. Campos editáveis: description, type, expectedAmount, amount, transactionDate, dueDate, accountId, categoryId, ownerMemberId e notes. Não aplica defaults de criação a campos omitidos. Lançamentos PAID exigem reabertura antes de **qualquer edição ou cancelamento**. CANCELLED não pode ser editado, pago ou reaberto nesta etapa. DELETE de cancelado é idempotente.

## Dinheiro e estados

`expectedAmount` e `amount` são positivos quando presentes; pelo menos um deve existir. Zero, negativos, valores com mais de duas casas e ambos nulos são rejeitados. EXPENSE define saída; o valor não recebe sinal negativo. Strings decimais são o contrato preferido e as respostas usam duas casas (`"217.30"`), preservando Decimal(19,2). Números JSON seguros seguem o contrato compartilhado existente.

`amount` pode ser conhecido antes do pagamento e permanecer num lançamento PENDING. Portanto, preencher amount não significa baixa.

```json
{ "amount": "217.30", "paidAt": "2026-10-10T14:30:00-03:00" }
```

Na baixa, `paidAt` é obrigatório e deve ser timestamp ISO com timezone. `amount` é opcional: usa primeiro o amount já conhecido e, se não existir, expectedAmount. PAID nunca é produzido sem amount e paidAt. Somente pendentes/atrasados recebem baixa. Uma segunda baixa retorna 409, evitando sobrescrita acidental.

Reabrir mantém `amount`, limpa `paidAt` e persiste PENDING. O estado efetivo pode ser OVERDUE se já venceu. Cancelar mantém histórico e valores, persiste CANCELLED e exclui o registro dos totais. Pagos precisam ser reabertos antes de cancelar. Não há atualização de saldo de Account nesta task.

As mutações bloqueiam a linha Transaction dentro de transação PostgreSQL, evitando baixas concorrentes que sobrescrevam valores. Validações de categoria compartilham o lock consultivo por workspace do CategoriesService, evitando mudança concorrente de tipo. A seleção de conta adquire lock de leitura durante validação/gravação. Erros de payload/regras retornam 400, estado incompatível 409, acesso ausente 401/403 e recurso ausente no tenant 404. A interface mostra mensagens próprias, sem detalhes internos do Prisma.

## Competência, datas e atraso

- transactionDate: data civil do fato.
- dueDate: data civil prevista de entrada/saída.
- competenceDate: primeiro dia do mês de dueDate, calculada também ao editar o vencimento.
- paidAt: instante efetivo, preservado como timestamp e serializado em UTC.

Energia com transactionDate 29/09/2026 e dueDate 10/10/2026 pertence a **outubro/2026**, competenceDate 2026-10-01.

Campos DATE entram e saem como `YYYY-MM-DD`; a API usa meia-noite UTC apenas como representação para o Prisma, e a Web formata os componentes da string diretamente, sem conversão de timezone. `brazilToday` é compartilhado e considera America/Sao_Paulo, independentemente do timezone do servidor. `dates.ts` centraliza exibição, navegação mensal e conversão de pagamento na Web.

A UI solicita data de pagamento, sem horário. Por convenção explícita, envia **12:00:00-03:00** desse dia. A API também aceita timestamps completos com outros horários e offsets.

OVERDUE é calculado na leitura: pendente com dueDate menor que o dia atual brasileiro. No próprio vencimento permanece PENDING. Filtros de status aplicam a mesma regra. Nenhum job diário ou atualização em massa é necessário. Um eventual registro legado persistido como OVERDUE é tratado com a mesma regra na leitura. Pagos e cancelados não ficam atrasados. A tela recalcula ao buscar dados novamente; não há atualização automática à meia-noite.

## Resumo mensal

```json
{
  "income": { "expected": "5000.00", "realized": "5000.00" },
  "expense": { "expected": "200.00", "realized": "217.30" }
}
```

`expected` soma expectedAmount dos registros não cancelados, inclusive pagos; null contribui zero e não recebe fallback de amount. `realized` soma amount **somente de PAID**. Registros com amount conhecido mas ainda pendentes não contam como realizados. CANCELLED é excluído de ambos. A competência, não paidAt, determina o mês dos totais. Soma realizada no PostgreSQL NUMERIC e composição via Decimal, sem Number.

Os quatro indicadores na tela representam todo o mês. Filtros da listagem não alteram esses indicadores; isso é indicado na interface. Valores diferentes exibem previsto, realizado e diferença por lançamento. Diferenças usam centavos inteiros com BigInt. Não há gráficos ou dashboard.

## Estado por workspace

A tela é remontada ao trocar workspace, descartando lista, resumo, filtros, formulário e feedback anteriores. Requisições usam AbortController; respostas antigas não atualizam a nova instância. Transactions, Accounts, Categories e resumo são buscados no novo contexto. Mudança de mês/filtro e refresh ocultam os dados antigos durante o carregamento.

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

`transactions.integration.mjs` usa API NestJS e PostgreSQL local reais com JWT/JWKS de teste. Cobre receita/despesa, precisão, competência, edição, valores inválidos, campos protegidos, vínculos, baixa e fallback, reabertura, cancelamento, atraso, filtros, totais, inativos, VIEWER, concorrência e isolamento de leitura/edição/baixa/reabertura/cancelamento entre workspaces. Limpeza remove exclusivamente fixtures próprias.

Os testes Web cobrem criação por tipo, categorias compatíveis, vazio, navegação mensal, filtro, baixa, diferença, recebimento, reabertura, cancelamento, troca de workspace, VIEWER, erros e datas civis/virada brasileira.

Cenário executado em Chromium: Energia criada em 29/09/2026, vencendo em 10/10/2026, ausente em setembro e presente em outubro. Baixa de R$ 217,30 preservou previsto de R$ 200,00. Salário de R$ 5.000,00 foi recebido em outubro. Resumo confirmado: receitas previstas/realizadas 5000.00/5000.00 e despesas previstas/realizadas 200.00/217.30. Filtros, reabertura, cancelamento, troca de workspace e descarte de opções antigas também passaram.

Desktop (1440 px), tablet (768 px) e celular (390 px) sem erros de console ou overflow horizontal. O provedor de identidade é simulado; operações usam API e PostgreSQL reais. Não é uma nova validação manual de credenciais reais do Supabase.

- [Lançamentos — desktop](screenshots/transactions-desktop.png)
- [Lançamentos — tablet](screenshots/transactions-tablet.png)
- [Lançamentos — celular](screenshots/transactions-mobile.png)

A suíte mantém os testes anteriores. O build emite o aviso já existente de bundle Web acima de 500 kB; não impede build ou execução.
