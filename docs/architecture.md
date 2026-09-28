# Arquitetura inicial

A Web React consome a API REST NestJS; um futuro mobile poderá consumir a mesma API. Nenhum aplicativo mobile é criado nesta etapa.

`packages/types` contém contratos TypeScript, `packages/validation` schemas Zod e `packages/config` configurações de TypeScript, ESLint e Prettier. Os contratos compartilhados cobrem health, usuário, workspace e validação dos formulários de autenticação. Pacotes de contratos compilam para JavaScript CommonJS e declarações TypeScript, utilizáveis pela API e por bundlers Web.

Turborepo ordena builds e mantém cache dos artefatos. O modo dev compila dependências primeiro e observa alterações nos pacotes e aplicações. A API usa o compilador TypeScript para preservar os metadados de decorators do NestJS.

PostgreSQL roda em Docker com volume persistente e porta acessível apenas no host local. Prisma contém o [schema financeiro v1 e a migration inicial](database.md), com Workspace como tenant e FKs compostas para integridade entre entidades financeiras. A API gera Prisma Client e usa o adapter PostgreSQL para bootstrap do usuário e consulta de membership. Supabase fornece somente Auth; a API valida JWT via JWKS. Veja [autenticação](authentication.md).

Vite resolve o pacote de validação para seu fonte TypeScript, permitindo ESM e HMR na Web. A API usa a saída CommonJS compilada do mesmo pacote.
