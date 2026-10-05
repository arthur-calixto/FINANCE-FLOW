# FINANCE FLOW

Fundação de um sistema Web-first de gestão financeira pessoal e familiar.
O projeto contém a fundação técnica, schema financeiro v1 e autenticação via Supabase com contexto de workspace. As Tasks 04–08 adicionam contas, categorias, lançamentos simples, parcelamentos, recorrências e cartões/faturas, com competência por vencimento, baixa e resumo mensal. Não há dashboard financeiro ou aplicativo mobile.

## Arquitetura

```text
apps/
  web/         React + Vite + TypeScript
  api/         NestJS + TypeScript, API REST
packages/
  types/       Contratos TypeScript compartilhados
  validation/  Schemas Zod compartilhados
  config/      TypeScript, ESLint e Prettier
prisma/        Schema financeiro PostgreSQL e migrations
docs/         Decisões de arquitetura
```

Veja [a arquitetura](docs/architecture.md). A API permanece independente da Web para atender também um futuro aplicativo mobile.

## Requisitos e instalação

- Node.js 24 LTS recomendado (`nvm use`); Node.js 22.12+ LTS também aceito.
- pnpm 10.34.5, fixado em `packageManager`.
- Docker com Docker Compose.

```bash
npm install --global pnpm@10.34.5
pnpm install
cp .env.example .env
```

Edite `.env` e substitua a senha de exemplo por uma senha local. Mantenha `DATABASE_URL` coerente com `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` e `POSTGRES_DB`; caracteres especiais na URL precisam de percent-encoding. Nunca versione `.env`.

A API carrega o `.env` da raiz nos scripts `dev` e `start`. `API_PORT` define a porta da API e `WEB_ORIGIN` a origem Web permitida por CORS. O Compose e o Prisma também usam o `.env` da raiz. Configure VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY e SUPABASE_URL com o mesmo projeto Auth. VITE_API_URL aponta para a API local. Nunca exponha credenciais em variáveis VITE_*. Veja [autenticação e recuperação de senha](docs/authentication.md).

## PostgreSQL e Prisma

```bash
docker compose up -d postgres
docker compose ps
pnpm db:validate
```

O PostgreSQL fica em `localhost:5432`, com volume persistente. Se a porta estiver ocupada, altere `POSTGRES_PORT` e a porta em `DATABASE_URL` no `.env` local (por exemplo, para 5433). Para parar mantendo os dados, use `docker compose down`. Alterações de usuário/senha no `.env` não reconfiguram um volume já inicializado.

Prisma 7 está configurado em `prisma.config.ts` e `prisma/schema.prisma`, com 11 models e a migration inicial. Após iniciar PostgreSQL, execute `pnpm db:migrate` para aplicar as migrations e `pnpm db:test` para validar a integridade no banco local. Veja [o modelo de dados e suas invariantes](docs/database.md). A API usa Prisma Client e adapter PostgreSQL para bootstrap e membership. O health check continua independente de PostgreSQL.

## Desenvolvimento

Monorepo inteiro (Web, API e observação dos pacotes compartilhados):

```bash
pnpm dev
```

Somente Web, em http://localhost:5173:

```bash
pnpm exec turbo run dev --filter=@finance-flow/web
```

Somente API, em http://localhost:3000, incluindo observação dos contratos:

```bash
pnpm exec turbo run dev --filter=@finance-flow/api...
```

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

A Web possui /login, /register, /forgot-password, /reset-password e /app. A API expõe /health público e /me, /workspaces e /workspaces/:id protegidos. Consulte [o fluxo e configuração Supabase](docs/authentication.md).

## Qualidade e build

```bash
pnpm lint
pnpm build
pnpm test
pnpm format:check
# Para aplicar formatação:
pnpm format
```

O Turborepo ordena os builds de dependências e mantém cache. O lint inclui ESLint e verificação TypeScript por pacote. O teste de integração usa o test runner nativo do Node, inicia o NestJS em porta efêmera e verifica status HTTP, corpo e contrato Zod de `/health`, além do 404 na raiz. A suíte Web usa Vitest e Testing Library para testar os fluxos centrais. `pnpm test:database` valida bootstrap concorrente e autorização no PostgreSQL local após o build.

Após `pnpm build`, execute a API com `pnpm --filter @finance-flow/api start` e confira a Web compilada com `pnpm --filter @finance-flow/web preview` (preview local, não servidor de produção).

O lockfile deve ser versionado; em CI use `pnpm install --frozen-lockfile`.

## Contas e categorias

A área autenticada possui `/app/accounts` e `/app/categories`. Ambas usam o workspace ativo e oferecem criação, edição, desativação e reativação. A API expõe GET/POST nas coleções e GET/PATCH/DELETE nos detalhes, protegidos por JWT e `X-Workspace-Id`. Veja [conceitos, regras, testes e screenshots](docs/accounts-and-categories.md).

## Lançamentos

`/app/transactions` permite criar receitas/despesas, alternar competência, filtrar, editar, pagar/receber, reabrir e cancelar. A API disponibiliza CRUD em `/transactions`, operações `/pay` e `/reopen` e `/transactions/summary?month=YYYY-MM`. Veja [contratos, datas, estados e validação](docs/transactions.md).

## Cartões e faturas

`/app/credit-cards` oferece cadastro, limite, compras à vista, faturas atuais/futuras e pagamento integral. A liquidação registra saída de caixa na fatura sem criar outra despesa. Execute `pnpm db:migrate` para aplicar a migration aditiva de pagamento. Veja [calendário, API, limite e liquidação](docs/credit-cards.md).

## Parcelamentos

Receitas/despesas e compras no cartão oferecem Pagamento → Parcelado, com prévia e até 120 parcelas. O detalhe fica em `/app/installment-groups/:id`. Divisão em centavos exatos, datas com dia-base preservado e limite comprometido pelo total. Veja [contratos, cancelamentos e limitações de retry](docs/installments.md).

## Recorrências e fixos (FIN-8)

Receitas/despesas mensais e anuais com janela móvel de 12 meses, prévia, edição individual ou futura e encerramento preservando histórico. A migration `20260929223000_recurrences` é aditiva; aplique com `pnpm db:migrate`. Não execute reset. Contratos, decisões e limitações em [docs/recurrences.md](docs/recurrences.md).

## Visão mensal e exclusão definitiva — FIN-9

Lançamentos agrupados por receitas/despesas, recorrentes, cartões e outros, com subtotais e resultado previsto/realizado. Cancelar mantém histórico; excluir definitivamente remove o registro mediante confirmação e regras de integridade. Aplique a migration aditiva `20260930122000_transaction_deletion` com `pnpm db:migrate`, sem reset. Contratos, tombstones de recorrência, proteção de faturas pagas e validação em [docs/transactions-view.md](docs/transactions-view.md). Dashboard permanece na FIN-10.

### Compartilhamento familiar

Em **Configurações**, crie um workspace familiar e convide pessoas por link.
Cada pessoa usa sua própria conta; seu workspace pessoal permanece privado.
OWNER administra membros, enquanto MEMBER pode gerenciar todas as finanças do
workspace compartilhado. Consulte [Membros e convites](docs/workspace-sharing.md)
para endpoints, segurança, expiração, revogação e limitações do MVP.

### Dashboard financeiro

A página inicial `/app` reúne receitas, despesas, pendências e resultados por
competência, próximos vencimentos, categorias, composição e evolução de seis meses.
Contas e cartões mostram saldos e limites atuais. As ações rápidas reutilizam o
formulário de lançamentos. Consulte [Dashboard financeiro](docs/dashboard.md) para
as regras de cálculo, reconciliação, tratamento de faturas e contrato da API.
