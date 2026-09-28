# Arquitetura inicial

A Web React consome a API REST NestJS; um futuro mobile poderá consumir a mesma API. Nenhum aplicativo mobile é criado nesta etapa.

`packages/types` contém contratos TypeScript, `packages/validation` schemas Zod e `packages/config` configurações de TypeScript, ESLint e Prettier. O contrato de health é o único contrato inicial. Pacotes de contratos compilam para JavaScript CommonJS e declarações TypeScript, utilizáveis pela API e por bundlers Web.

Turborepo ordena builds e mantém cache dos artefatos. O modo dev compila dependências primeiro e observa alterações nos pacotes e aplicações. A API usa o compilador TypeScript para preservar os metadados de decorators do NestJS.

PostgreSQL roda em Docker com volume persistente e porta acessível apenas no host local. Prisma contém o [schema financeiro v1 e a migration inicial](database.md), com Workspace como tenant e FKs compostas para integridade entre entidades financeiras. Ainda não há client gerado ou conexão da API ao banco. A geração do client e o adapter PostgreSQL serão adicionados quando houver uso concreto da persistência.
