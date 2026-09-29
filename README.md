# FINANCE FLOW

Fundação de um sistema Web-first de gestão financeira pessoal e familiar.
O projeto contém a fundação técnica, schema financeiro v1 e autenticação via Supabase com contexto de workspace. A Task 04 adiciona gerenciamento de contas e categorias, sem lançamentos, dashboard financeiro ou aplicativo mobile.

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
