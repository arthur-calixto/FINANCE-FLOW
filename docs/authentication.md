# Autenticação e contexto de Workspace

Supabase Auth é o único Identity Provider. Cadastro, confirmação, login, refresh, logout e recuperação de senha são delegados ao SDK oficial. A API não recebe senhas e não emite tokens próprios. PostgreSQL e Prisma continuam locais via Docker: a URL de Auth não substitui DATABASE_URL.

## Configuração

Copie `.env.example` para `.env` somente na instalação inicial; preserve as configurações existentes.

| Variável                      | Uso                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| DATABASE_URL                  | PostgreSQL local, acessado somente pela API/Prisma.                    |
| VITE_SUPABASE_URL             | URL pública do projeto Supabase Auth.                                  |
| VITE_SUPABASE_PUBLISHABLE_KEY | Chave publicável do projeto, nunca secret/service_role.                |
| SUPABASE_URL                  | Mesmo projeto, utilizado no backend para fixar issuer e endpoint JWKS. |
| VITE_API_URL                  | Origem da API, padrão http://localhost:3000.                           |
| WEB_ORIGIN                    | Origem Web permitida por CORS, padrão http://localhost:5173.           |
| API_PORT                      | Porta da API, padrão 3000.                                             |

Vite lê o `.env` da raiz via `envDir` e expõe somente variáveis VITE_. Não coloque credenciais de banco ou secret keys nesse prefixo. Reinicie os servidores após modificar configurações; builds Web incorporam as variáveis públicas.

No Supabase, habilite login por e-mail/senha e confirmação de e-mail. Configure Site URL como `http://localhost:5173` e permita os retornos `http://localhost:5173/login` e `http://localhost:5173/reset-password` (equivalentes HTTPS no ambiente publicado). O projeto deve usar chave assimétrica ES256 ou RS256; a configuração local foi verificada por JWKS e usa ES256. HS256 não recebe fallback inseguro: configure uma chave assimétrica antes de utilizar esta API.

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

O Prisma Client é gerado no build/dev da API em `apps/api/src/generated/prisma`, ignorado pelo Git. Usa `@prisma/adapter-pg` e a mesma conexão local. `pnpm db:generate` gera o client manualmente.

## Fluxo Web

- `/register`: nome, e-mail, senha e confirmação (mínimo local de 8 caracteres; políticas adicionais do Supabase continuam valendo). Nome enviado em `user_metadata.name`. Sem sessão retornada, exibe instrução de confirmação, sem liberar `/app`.
- `/login`: autentica no Supabase. A sessão dispara `/me`, que garante User e Workspace. Somente depois disso a área autenticada é carregada.
- `/forgot-password`: solicita e-mail de recuperação com retorno a `/reset-password`, exibindo mensagem neutra sobre existência da conta.
- `/reset-password`: SDK processa o retorno; sessão válida permite `updateUser({ password })`. Depois da alteração, encerra a sessão local e retorna ao login.
- `/app`: página simples com nome, workspace, seleção validada e logout. Sem sessão, redireciona para `/login`.

Há uma única instância Supabase. AuthProvider ouve `onAuthStateChange` com callback síncrono; chamadas ao SDK/API ocorrem fora do callback para evitar deadlocks. O SDK gerencia a persistência e renovação da sessão. A aplicação não grava JWT manualmente. Armazena somente preferência de workspace por usuário e um marcador de recuperação na aba. Dados carregados são cancelados/descartados quando a sessão muda. Logout limpa contexto e seleção e encerra a sessão neste navegador (`scope: local`).

O fluxo usa PKCE: abra o link de confirmação/recuperação no mesmo navegador e perfil que iniciou a solicitação. Links expirados ou abertos sem o verifier exigem uma nova solicitação. Recuperação tem prioridade sobre a navegação à área autenticada. Não cole tokens, senhas ou links de recuperação na conversa ou em logs.

## JWT e autenticação

`AuthGuard` extrai Bearer e chama `JwtVerifier`. JOSE verifica criptograficamente a assinatura com chaves públicas de `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, usando cache e atualização por kid. Valida issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`, algoritmos permitidos ES256/RS256, expiração, presença de iat/sub/exp/iss/aud e claims de identidade (sub UUID, e-mail e role authenticated). Identidades anônimas são recusadas. Não utiliza service-role, decode isolado nem chamada de validação ao Supabase em cada request.

Tokens ausentes/inválidos/expirados retornam 401. Claims não são retornadas por `/me` nem registradas em logs. Metadata é usada somente como nome de exibição, nunca como autorização. A confirmação de e-mail é aplicada pelo Supabase antes de emitir a sessão quando essa opção está habilitada.

Validação local de JWT não revoga instantaneamente access tokens já emitidos: após logout eles podem continuar válidos até expirar. Use duração de token adequada no Supabase. A revogação/refresh de sessão é responsabilidade do Identity Provider.

## Identidade de domínio e bootstrap

A migration `20260928190000_supabase_identity` adiciona `User.authUserId UUID UNIQUE`, nullable para preservar registros legados. O UUID interno User.id continua independente. Novos usuários do bootstrap sempre têm authUserId. Nunca vincular contas automaticamente por e-mail.

`IdentityService.bootstrap()` executa uma transação Prisma com lock consultivo transacional PostgreSQL por authUserId. O lock serializa chamadas simultâneas do mesmo usuário entre instâncias da API. Sob esse lock, busca o vínculo; se existir, sincroniza e-mail/nome autenticados e retorna o usuário. Caso contrário cria User, Workspace `Pessoal`/PERSONAL com ownerId correto e WorkspaceMember OWNER na mesma transação. Falha em qualquer etapa reverte todas as gravações. A unicidade é uma proteção adicional contra duplicação.

E-mail que conflite com outra identidade ou usuário legado retorna 409, sem apropriar conta e sem criar workspace parcial. Vinculação de legados exige procedimento explícito futuro. Mudanças de e-mail/nome chegam via JWT renovado, portanto sincronização não é instantânea quando existe token antigo válido. `avatarUrl` não é sincronizado nesta tarefa.

## Endpoints e autorização

| Endpoint            | Proteção                   | Resposta                                                                                |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| GET /health         | Público                    | `{ "status": "ok" }`, independente de banco/Auth.                                       |
| GET /me             | AuthGuard                  | `{ user: { id, name, email }, workspaces: [{ id, name, type, role }] }`, com bootstrap. |
| GET /workspaces     | AuthGuard                  | Somente memberships do usuário atual.                                                   |
| GET /workspaces/:id | AuthGuard + WorkspaceGuard | Workspace solicitado com papel do usuário.                                              |

A convenção é `Authorization: Bearer <access_token>` e `X-Workspace-Id: <uuid>` para endpoints com contexto de workspace. No detalhe, header e parâmetro `:id` devem coincidir; ausência, UUID malformado ou divergência retornam 400. O guard busca `(workspaceId, userId)` no banco. Sem membership, retorna o mesmo 403 para UUID inexistente ou de outro tenant, evitando revelar existência.

`@CurrentIdentity()` fornece a identidade autenticada; `@CurrentWorkspace()` fornece o workspace e papel autorizados. Futuros controllers devem aplicar os guards nessa ordem e usar o workspace do contexto em todas as consultas. Não usar diretamente UUID do body/header para consultar entidades financeiras. Membership permite acesso ao contexto, mas permissões de escrita por papel ainda devem ser aplicadas aos futuros endpoints financeiros.

Seleção é local, sem endpoint de mutação: a Web valida a escolha em GET /workspaces/:id e persiste apenas o ID. Um ID guardado não concede acesso; a lista é revalidada no bootstrap e cada requisição contextualizada verifica membership no backend. Somente um workspace é selecionado automaticamente; para múltiplos, a interface já contém seletor. Nenhuma criação de FAMILY ou convite foi adicionada.

## Testes e validação manual

```bash
pnpm lint
pnpm build
pnpm test
pnpm test:database
pnpm db:test
pnpm format:check
pnpm db:validate
pnpm exec prisma migrate status
```

`pnpm test` verifica JWTs assinados por chaves efêmeras com servidor JWKS local, rejeições 401, health e comportamentos Web com SDK simulado. Não contata o Supabase real e não precisa do PostgreSQL para esses testes.

`pnpm test:database` exige build e migrations aplicadas. Inicia API real em porta efêmera e usa PostgreSQL local para verificar criação, OWNER, concorrência, repetição, sincronização, isolamento, 403 e conflito de e-mail. Cria fixtures com UUIDs exclusivos e remove somente essas fixtures no finally. Recusa hostname de banco que não seja localhost/127.0.0.1. `pnpm db:test` mantém os testes SQL anteriores e os 11 CHECKs.

Validação manual com o projeto real (precisa do acesso do usuário ao e-mail):

1. Abrir `/register`, cadastrar nome/e-mail/senha e verificar mensagem de confirmação.
2. Confirmar o e-mail no mesmo navegador; entrar por `/login` se necessário.
3. Conferir `/app`, nome e workspace Pessoal; no banco conferir um User vinculado, um Workspace PERSONAL e membership OWNER.
4. Sair, acessar `/app` e conferir redirecionamento para login.
5. Entrar novamente; confirmar mesmos IDs e contagem de workspaces.
6. Solicitar recuperação em `/forgot-password`, abrir link, trocar senha e entrar com a nova senha.

Os testes automatizados não substituem a validação de entrega de e-mail/Redirect URLs no projeto Supabase real. Registrar o resultado desse roteiro separadamente.

Referências: [JWT e JWKS](https://supabase.com/docs/guides/auth/jwts), [eventos de autenticação](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Resultado da validação desta implementação

Migration aplicada no PostgreSQL local sem reset; comparação com schema sem diferenças. Testes aprovados: 12 verificações no backend, 16 testes Web e 5 verificações de integração com PostgreSQL, além da suíte SQL dos 11 CHECKs. Chromium isolado confirmou carregamento de login/cadastro/recuperação/redefinição e redirecionamento de /app sem sessão, sem erros JavaScript.

A entrega de e-mail, confirmação real, login real, segundo login e recuperação com o projeto Supabase aguardam validação assistida pelo proprietário do e-mail. Nenhuma senha/token real foi coletada nos testes. Build passa com aviso de bundle Web acima de 500 kB (aproximadamente 563 kB, 163 kB gzip); divisão adicional de bundle pode ser feita em uma etapa de otimização.
