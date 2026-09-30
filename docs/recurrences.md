# Recorrências e lançamentos fixos — FIN-8

Receitas e despesas mensais/anuais usam `Recurrence` e geram Transactions reais no fluxo de conta bancária. A identificação de fixo é `recurrenceId != null`. Não há checkbox em lançamento avulso, recorrência no cartão, mistura com InstallmentGroup nem reorganização da tela de lançamentos nesta entrega.

## Modelo e migration

A migration aditiva `20260929223000_recurrences` acrescenta:

- `Recurrence.notes`: observação padrão.
- `Transaction.recurrenceDate`: data original imutável da ocorrência, separada do vencimento editável. A chave única `(recurrenceId, recurrenceDate)` impede duplicação mesmo se o vencimento ou a competência forem alterados individualmente. Datas de eventuais ocorrências legadas são preenchidas com dueDate antes de criar o índice; duplicatas fariam a migration falhar, sem apagar registros.
- `RecurrenceRevision`: regras completas de descrição, valor previsto, conta, categoria e notes, vigentes a partir de `effectiveDate`. Chave única por recurrenceId/effectiveDate, autoria, timestamps, CHECK monetário positivo e FKs compostas por workspace. O tipo e o calendário continuam no modelo Recurrence.

Não houve reset ou exclusão de histórico. `recurrenceDate` é preenchida pelo materializador e não é aceita em payloads de edição. A API também não aceita atribuir recurrenceId a um lançamento avulso. A FK garante isolamento; as regras de origem e imutabilidade são aplicadas pelo serviço.

## Janela móvel e calendário

`ensureRecurrenceHorizon(workspaceId)` mantém o mês civil atual brasileiro e os 11 seguintes. Em outubro/2026, a janela é `[2026-10-01, 2027-10-01)`. Não são obrigatoriamente 12 títulos: uma série anual, encerrada ou com início futuro terá menos ocorrências nessa mesma janela.

A materialização ocorre ao criar/alterar recorrência, consultar lista/detalhe de recorrências e consultar lançamentos/resumo mensal. Não exige cron nem manutenção manual. Ler um mês fora da janela não expande arbitrariamente o horizonte; mostra apenas títulos já existentes. Uma nova consulta após a mudança do mês adiciona as ocorrências que entraram na janela. A página aberta não se atualiza sozinha à meia-noite.

O cursor `nextGenerationDate` registra o limite exclusivo já processado. O início efetivo de uma varredura é o maior entre cursor e início do mês atual. Cadastrar firstDueDate no passado não preenche competências anteriores: gera a ocorrência aplicável no mês atual, mesmo já vencida, e as seguintes. Se houver um longo período sem uso, meses passados não materializados também não são preenchidos automaticamente. Títulos já existentes nunca são excluídos ao avançar a janela.

Frequências suportadas: **MONTHLY e YEARLY**, exatamente as existentes no enum. A UI oferece Mensal e Anual, intervalo 1. A API preserva `interval` do modelo e aceita inteiros de 1 a 120 (meses ou anos conforme frequência).

- Mensal: mantém o dia de firstDueDate, limitado ao último dia de cada mês. 31/01 → 28/02 → 31/03; em ano bissexto, 29/02.
- Anual: mantém mês e dia originais. 29/02 → 28/02 em ano comum e volta a 29/02 no bissexto.
- O cálculo avança a partir da âncora original, nunca da data ajustada do mês anterior.
- Não gera antes de firstDueDate. Uma série que começa fora da janela permanece cadastrada até sua primeira ocorrência entrar nela.

Cada título nasce com `expectedAmount` da regra vigente, `amount = null`, `status = PENDING`, conta, categoria, descrição e notes. transactionDate e recurrenceDate são inicialmente o vencimento programado; competenceDate é o primeiro dia desse mês. Valores usam Decimal/string, sem Float. OVERDUE é calculado na leitura.

## Atomicidade, concorrência e exceções

Criação da série e das ocorrências acontece em uma única transação. Geração, revisões, encerramento, edições individuais e baixas compartilham o lock consultivo de categoria/workspace já existente. Conta selecionada também recebe FOR SHARE durante validação. A constraint de ocorrência e `createMany(skipDuplicates)` complementam o lock.

O materializador só insere títulos ausentes; não faz update dos existentes. Portanto não restaura valores antigos, não recria cancelados e não altera pagos ou vencimentos personalizados. A identidade usa a data original, permitindo mais de uma ocorrência em uma competência quando um vencimento foi deslocado individualmente.

VIEWER pode consultar e desencadear manutenção automática da janela, mas não criar, editar ou encerrar regras. Títulos automáticos mantêm createdBy da série; a autoria da regra foi validada na criação e as revisões registram o usuário autorizado que as aplicou. JWT, membership e workspace são exigidos antes de chamar os serviços. Todos os lookups, títulos e revisões são limitados ao tenant.

A criação HTTP de duas séries com payload igual representa duas intenções distintas: não há chave persistida para deduplicar POST após resposta perdida. A idempotência implementada aqui é da geração de ocorrências de **uma mesma série**. A UI bloqueia envio enquanto processa e não repete criação automaticamente.

## Edição

**Somente este lançamento:** PATCH da Transaction com `recurrenceScope: "ONE"`. Atualiza somente a ocorrência pendente/atrasada. Pode alterar descrição, valor previsto, conta, categoria, notes e vencimento, além dos campos bancários existentes. Mantém recurrenceDate. Tipo não pode mudar, expectedAmount não pode ser removido e uma ocorrência PAID exige reabertura antes da edição individual. A regra da série permanece intacta.

**Este e os próximos:** PATCH da Recurrence com `fromTransactionId`. O corte usa recurrenceDate da ocorrência selecionada, mesmo que seu vencimento tenha sido deslocado. Registra uma regra completa em RecurrenceRevision e aplica a regra vigente aos títulos PENDING/OVERDUE a partir do corte, até o encerramento. Ocorrências anteriores, PAID e CANCELLED são preservadas. Se o próprio corte estiver PAID, a baixa permanece intacta e a nova regra vale para os elegíveis seguintes.

Revisões posteriores já agendadas permanecem válidas. Exemplo: janeiro 135, março 150; editar novembro para 125 mantém janeiro 135 e março 150. Um segundo ajuste no mesmo corte substitui aquela regra, preservando o createdAt e atualizando autoria/updatedAt. Não se trata de um log de auditoria completo de cada edição.

Uma edição explícita “este e os próximos” pode substituir exceções individuais de valor/descrição/vínculos dos títulos pendentes atingidos. Não altera seus vencimentos personalizados nem amount já conhecido. Isso é diferente da materialização, que nunca sobrescreve títulos existentes. A UI informa que regras posteriores, pagas e canceladas permanecem preservadas.

**Limitação adotada conforme a alternativa permitida:** frequência, intervalo, dia-base, tipo e data inicial não são editáveis após criação. Para outro calendário, encerre a série e cadastre outra. As edições futuras permitem valor previsto, descrição, conta, categoria e notes.

O detalhe/listagem apresenta os defaults da regra correspondente à próxima ocorrência pendente futura (ou à data atual quando não há próxima ocorrência), mais as revisões agendadas. Uma exceção individual ou amount realizado não redefine esse valor-base.

## Pagamento, cancelamento e encerramento

Baixa/recebimento usa os endpoints FIN-5. Pagar 126.90 para previsto 120 preserva expectedAmount 120 e a regra 120; somente a Transaction recebe amount/paidAt/PAID. O resumo soma Transactions materializadas, nunca a Recurrence. Não duplica receitas/despesas.

Cancelar somente um lançamento usa DELETE /transactions/:id. Cancela a ocorrência sem interromper a série; a chave original permanece e impede recriação. CANCELLED não é reativado pelo materializador.

Encerrar usa DELETE /recurrences/:id com **fromDate explícita**. `endDate` é corte exclusivo de geração: ocorrências com recurrenceDate >= fromDate não são mais geradas e pendentes já existentes nessa faixa viram CANCELLED. Antes do corte, histórico permanece. PAID é sempre preservado, inclusive depois do corte. Reabrir uma ocorrência paga situada na faixa encerrada é bloqueado para não restaurar um compromisso encerrado.

Encerramento futuro aparece como ENDING (Encerramento agendado); a série ainda gera até o corte. Quando o corte chega, a leitura apresenta ENDED e o materializador inativa a série. Não é permitido mover o fim para uma data posterior, retomar ou apagar fisicamente a série. É permitido antecipar o corte. Comparações de corte usam a data original, não um vencimento excepcional.

Pausa/retomada não foram implementadas: priorizou-se encerramento consistente, conforme o escopo opcional. `isActive` não é exposto como um toggle que pudesse reativar compromissos cancelados.

Conta/categoria precisam estar ativas, no workspace e de tipo compatível ao criar ou trocar o vínculo. Desativação posterior não apaga histórico, impede baixa nem interrompe obrigações já cadastradas: a geração continua com os vínculos existentes. Mudança do tipo de categoria é bloqueada se conflitar com séries/revisões, inclusive quando a primeira ocorrência ainda está fora da janela.

## Contratos REST

Todos exigem JWT e X-Workspace-Id. Escritas exigem OWNER/ADMIN/MEMBER; preview é leitura.

| Método | Rota                       | Uso                                                             |
| ------ | -------------------------- | --------------------------------------------------------------- |
| GET    | `/recurrences`             | Lista, defaults, próximo vencimento e status; garante horizonte |
| GET    | `/recurrences/:id`         | Detalhe, ocorrências e revisões; garante horizonte              |
| POST   | `/recurrences/preview`     | Calendário da janela, sem gravação                              |
| POST   | `/recurrences`             | Cria série e ocorrências atomicamente; 201                      |
| PATCH  | `/recurrences/:id`         | Este e os próximos, com fromTransactionId                       |
| DELETE | `/recurrences/:id`         | Encerramento a partir de fromDate, sem hard delete              |
| PATCH  | `/transactions/:id`        | Somente este, com recurrenceScope ONE                           |
| DELETE | `/transactions/:id`        | Cancela somente a ocorrência                                    |
| POST   | `/transactions/:id/pay`    | Baixa individual                                                |
| POST   | `/transactions/:id/reopen` | Reabre PAID elegível, respeitando encerramento                  |

Criação:

```json
{
  "description": "Internet",
  "type": "EXPENSE",
  "expectedAmount": "120.00",
  "frequency": "MONTHLY",
  "firstDueDate": "2026-10-10",
  "interval": 1,
  "accountId": "UUID",
  "categoryId": "UUID",
  "notes": null
}
```

Preview recebe expectedAmount, frequency, firstDueDate e interval opcional. Retorna `from`, `until` exclusivo e `occurrences` com dueDate, competenceDate e expectedAmount. A UI exibe até cinco e informa quantas outras existem.

Edição individual:

```json
{ "recurrenceScope": "ONE", "expectedAmount": "140.00" }
```

Este e os próximos (ao menos uma alteração além do corte):

```json
{ "fromTransactionId": "UUID da ocorrência", "expectedAmount": "135.00" }
```

Encerramento:

```json
{ "fromDate": "2027-01-10" }
```

Campos protegidos/desconhecidos e calendário em PATCH de série são rejeitados. Dados inválidos retornam 400, estado incompatível 409 e IDs fora do workspace 404; sem membership, 403.

## Web e integração

`/app/recurrences` lista descrição, tipo, valor-base, frequência, próximo vencimento, conta, categoria e status. Formulário tem prévia obrigatória e descarta a prévia ao alterar campos. `/app/recurrences/:id` apresenta ocorrências e regras futuras, com edição, pagamento/recebimento, cancelamento individual e encerramento explícito.

A edição de uma Transaction recorrente apresenta “Somente este lançamento” / “Este e os próximos”; avulsas mantêm seu formulário anterior. A lista geral recebeu apenas identificação “Recorrente” e link, preservando estrutura, filtros e resumo. Troca de workspace remonta páginas/formulários, aborta leituras antigas e descarta dados anteriores.

Não há recorrência de cartão, hard delete, dashboard, reorganização de lançamentos, aplicativo mobile ou alteração da FIN-9.

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

Testes de calendário cobrem janela, início retroativo/futuro, meses curtos, ano novo, anual de 29/02 e intervalos. Integração PostgreSQL cobre INCOME/EXPENSE, 12 meses, avanço de relógio, chamadas simultâneas, constraint única, exceção individual com mudança de competência, regras fora de ordem, corte PAID, baixa com diferença, cancelamento sem recriação, encerramento, inativos, payloads protegidos, VIEWER e cross-tenant. SQL verifica também as FKs/valor positivo das revisões e unicidade da identidade da ocorrência.

Testes Web cobrem vazio, criação de receita/despesa, prévia obrigatória e invalidação, detalhe, escolhas de edição, baixa diferente, cancelamento individual, encerramento, identificação na lista, permissões, erros e troca de workspace. Os testes anteriores continuam na suíte.

Cenários Chromium executados com API NestJS/PostgreSQL reais, JWT/JWKS simulado e relógio do serviço fixado em 01/10/2026 para reproduzir a especificação:

- A — Internet: 12 ocorrências de 120; corte em janeiro/2027 alterou janeiro e seguintes para 135, preservando outubro–dezembro. Baixa de outubro por 126.90 manteve expectedAmount 120 e novembro 120.
- B — Salário: 12 ocorrências de 5000 e receita prevista de outubro 5000 no resumo.
- C — Cancelar dezembro manteve dezembro CANCELLED, janeiro PENDING e 12 títulos após nova materialização, sem recriação. Encerramento agendado em janeiro preservou a baixa de outubro e cancelou pendentes a partir do corte.
- Identificação/link na tela geral e troca de workspace também verificados. Desktop 1440, tablet 768 e celular 390 sem overflow horizontal ou erros de console.

Capturas:

- [Lista desktop](screenshots/recurrences-list-desktop.png), [tablet](screenshots/recurrences-list-tablet.png), [celular](screenshots/recurrences-list-mobile.png).
- [Detalhe desktop](screenshots/recurrences-detail-desktop.png), [tablet](screenshots/recurrences-detail-tablet.png), [celular](screenshots/recurrences-detail-mobile.png).

Resultado da suíte: 44 testes API/calendário, 65 Web, 56 integração PostgreSQL e integridade dos 12 modelos. Todos os comandos acima passaram, incluindo regressão das FIN anteriores. Permanecem avisos não bloqueantes de bundle Web acima de 500 kB e depreciação do driver pg em chamadas via Prisma. Não houve commit automático.
