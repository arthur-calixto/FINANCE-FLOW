# Contas, categorias e App Shell — Task 04

A área autenticada agora possui shell reutilizável em `/app`, contas em `/app/accounts` e categorias em `/app/categories`. A home apresenta atalhos simples de organização; Lançamentos e Cartões aparecem indisponíveis. Não há dashboard, cálculos por movimentação ou endpoints de Transactions.

## Contas

Account representa um lugar onde o usuário guarda dinheiro: conta corrente, poupança, dinheiro, investimento ou outra conta. A API exige nome não vazio após trim, tipo válido e moeda BRL. `initialBalance` é apenas o saldo de partida, positivo, zero ou negativo. Nenhuma Transaction é gerada, e nenhum saldo atual é calculado nesta tarefa.

Valores persistem como `Decimal(19,2)`. O contrato preferido de entrada é uma string decimal com ponto, por exemplo `"-350.25"`; a resposta sempre contém string com duas casas. Números JSON são aceitos dentro de faixa segura e com no máximo duas casas, conforme a especificação inicial. Para valores grandes, enviar string, evitando perda de precisão antes de alcançar a API. Não são aceitos NaN, notação exponencial, mais de duas casas ou mais de 17 dígitos inteiros.

A Web usa input textual com vírgula decimal, sem separador de milhar (`1500,00`, `-350,25`). Converte a representação para a string canônica, sem aritmética em ponto flutuante. `money.ts` centraliza parsing e formatação BRL com Intl.NumberFormat, preservando strings decimais sem conversão intermediária para Number.

`ownerMemberId` pode ser omitido ou null. A API permite informar um membership existente no mesmo workspace e rejeita vínculo cruzado. O formulário não adiciona seleção de responsáveis nesta etapa; edição sem esse campo preserva o responsável já existente.

## Endpoints

Todos exigem `Authorization: Bearer <token>` e `X-Workspace-Id: <uuid>`.

| Recurso    | Método e caminho       | Comportamento                                                 |
| ---------- | ---------------------- | ------------------------------------------------------------- |
| Contas     | GET /accounts          | Lista contas ativas do workspace.                             |
| Contas     | GET /accounts/:id      | Detalhe, inclusive de conta inativa, dentro do workspace.     |
| Contas     | POST /accounts         | Cria conta; HTTP 201.                                         |
| Contas     | PATCH /accounts/:id    | Edita campos fornecidos; `isActive: true` reativa.            |
| Contas     | DELETE /accounts/:id   | Define `isActive: false`; retorna o registro, HTTP 200.       |
| Categorias | GET /categories        | Lista categorias ativas do workspace.                         |
| Categorias | GET /categories/:id    | Detalhe, inclusive de categoria inativa, dentro do workspace. |
| Categorias | POST /categories       | Cria categoria ou subcategoria; HTTP 201.                     |
| Categorias | PATCH /categories/:id  | Edita campos fornecidos; `isActive: true` reativa.            |
| Categorias | DELETE /categories/:id | Desativa somente o registro selecionado, HTTP 200.            |

As listagens aceitam `?includeInactive=true`; por padrão omitem inativas. A Web carrega a lista do workspace incluindo inativas e aplica o filtro visual, para possibilitar reativação e preservar o contexto hierárquico.

Exemplos de criação:

```json
{
  "name": "Nubank",
  "type": "CHECKING",
  "initialBalance": "1500.00",
  "currency": "BRL"
}
```

```json
{ "name": "Alimentação", "type": "EXPENSE", "parentId": null }
```

PATCH é parcial e exige ao menos um campo. Payloads usam schemas Zod compartilhados e estritos: `workspaceId`, IDs gerados, timestamps e outros campos desconhecidos no body são rejeitados. Workspace vem exclusivamente do contexto autenticado.

## Exclusão lógica

DELETE é idempotente e não remove linhas. O histórico permanece preservado; PATCH com `isActive: true` reativa. A UI pede confirmação antes da desativação. Ao desativar um pai, **somente ele muda**; filhos e demais descendentes permanecem intactos.

Um pai inativo pode continuar aparecendo com badge Inativa se possuir descendentes ativos, mesmo com o filtro de inativas desligado. Isso evita mostrar filhos soltos e torna a hierarquia compreensível. Pais inativos podem ser escolhidos explicitamente no formulário, identificados como “(inativa)”; nesta tarefa inatividade não implica alteração estrutural ou proibição de vínculos históricos.

## Categorias e hierarquia

Tipos: INCOME (Receita) e EXPENSE (Despesa). O nome passa por trim e não pode ficar vazio. Não há seed de categorias: o usuário começa com a lista vazia.

O service garante:

- pai existente no mesmo workspace;
- mesmo tipo entre categoria e pai;
- impossibilidade de ser pai de si própria;
- impossibilidade de apontar para um descendente e formar ciclo;
- mudança de tipo rejeitada se um filho direto, inclusive inativo, ficar com tipo incompatível.

Ao criar ou editar, percorre a cadeia de ancestrais com um conjunto de IDs visitados. Todas as mutações de categoria são transacionais e adquirem o mesmo lock consultivo PostgreSQL por workspace. Assim duas reparentagens concorrentes não podem validar separadamente e depois formar um ciclo. O lock afeta somente categorias daquele workspace e dura até o fim da transação. Não há limite de dois níveis imposto pelo modelo ou service.

A Web separa Despesas e Receitas, renderiza listas aninhadas e permite criar subcategoria diretamente no pai. O seletor de pai filtra pelo tipo e exclui a própria categoria e seus descendentes. A validação do backend continua sendo a autoridade final.

## Autorização e erros

AuthGuard valida JWT, WorkspaceGuard consulta membership e fornece `@CurrentWorkspace()`. Cada consulta ou mutação de Account/Category inclui workspaceId, inclusive verificações de existência e lookups de pai. Atualizações utilizam a chave composta `(workspaceId, id)`. UUID conhecido de outro workspace resulta em 404 no recurso; seleção de workspace sem membership resulta em 403.

OWNER, ADMIN e MEMBER podem escrever; VIEWER só consulta. WriteGuard aplica essa distinção nos três métodos de mutação. Os botões de escrita não aparecem para VIEWER.

O guard anterior comparava qualquer parâmetro `:id` ao workspace. O detalhe de workspace agora utiliza `:workspaceId` internamente (a URL pública permanece igual), permitindo que `:id` das novas rotas identifique contas/categorias sem enfraquecer a autorização.

400 representa payload/regra inválida, 401 identidade inválida, 403 acesso negado, 404 recurso ausente no tenant e 409 conflito. Erros conhecidos do Prisma são traduzidos; a Web apresenta mensagens próprias e não renderiza stack trace ou resposta técnica do banco.

## UI e estado

Componentes em `apps/web/src/ui.tsx`: Button, Input, Select, FormField, Card, Badge, Dialog, ConfirmDialog, EmptyState, LoadingState e ErrorState. O dialog nativo oferece foco modal, navegação por teclado, Escape e restauração do foco; fechamento fica bloqueado durante gravações. Formulários têm labels e botões de envio desabilitados enquanto salvam.

Desktop usa sidebar e cards. Tablet e celular adaptam navegação, ações e formulários. Campos e status usam português; enums são traduzidos para labels de produto.

O shell remonta a área de conteúdo ao trocar `activeWorkspaceId`. As páginas também possuem chave por workspace e `useResources` cancela requisições com AbortController. Respostas de uma instância desmontada não atualizam a nova; formulários, erros e mensagens do workspace anterior são descartados. Não há cache global de recursos entre tenants.

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

A suíte PostgreSQL usa fixtures com UUIDs exclusivos e limpa somente os registros dos usuários criados pelo próprio teste. Cobre CRUD, saldos negativos e precisos, filtros, owner cruzado, desativação/reativação, parent cruzado, tipos incompatíveis, self-parent, ciclos, concorrência e permissões de VIEWER. A suíte anterior de autenticação/bootstrap permanece incluída em `test:database`.

Os testes Web cobrem contas vazias, criação, edição, confirmação de desativação/reativação, categorias/subcategorias, hierarquia, filtros de pais, filhos intactos e troca de workspace, além de precisão monetária e estados de erro/loading. Os testes anteriores de autenticação permanecem na suíte.

Validação em Chromium: login, criação de Nubank, edição, desativação/reativação, criação de Alimentação e Mercado como filha, troca de workspace, logout e Escape no diálogo. As operações usam API NestJS e PostgreSQL reais; o Identity Provider é simulado com JWT assinado e JWKS local, sem utilizar ou alterar a conta Supabase pessoal. Viewports: desktop 1440 px, tablet 768 px e celular 390 px. Nenhum erro JavaScript ou overflow horizontal foi observado.

Evidências visuais com dados exclusivos de teste:

- [Contas — desktop](screenshots/accounts-desktop.png)
- [Contas — celular](screenshots/accounts-mobile.png)
- [Categorias — desktop](screenshots/categories-desktop.png)
- [Categorias — tablet](screenshots/categories-tablet.png)
- [Categorias — celular](screenshots/categories-mobile.png)

Nenhuma alteração no schema ou migration foi necessária. Não foram implementados Transactions, saldos calculados, cartões, transferências, gráficos, templates de categorias ou novas modalidades de workspace.
