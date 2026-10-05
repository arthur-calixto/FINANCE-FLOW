# Membros e compartilhamento de workspace — FIN-10

Cada pessoa usa sua própria conta Supabase Auth. O bootstrap continua criando um
User e um workspace PERSONAL com OWNER. O compartilhamento cria memberships no
mesmo workspace FAMILY, sem copiar contas, categorias, lançamentos, cartões,
faturas, parcelamentos ou recorrências. Dados privados devem ficar no PERSONAL.

## Permissões e interface

Em `/app/settings`, qualquer usuário autenticado pode criar um FAMILY. Workspace
e membership OWNER são criados atomicamente. Nome é obrigatório, limitado a 120
caracteres. Não há alteração de tipo nem exclusão de workspace.

| Operação                                | OWNER de FAMILY | MEMBER |
| --------------------------------------- | --------------- | ------ |
| Ler e gerenciar todas as finanças       | Sim             | Sim    |
| Listar membros                          | Sim             | Sim    |
| Renomear FAMILY                         | Sim             | Não    |
| Criar/listar/cancelar convites          | Sim             | Não    |
| Remover MEMBER                          | Sim             | Não    |
| Remover OWNER ou transferir propriedade | Não             | Não    |

ADMIN e VIEWER permanecem no enum e mantêm suas permissões financeiras anteriores;
nenhum deles ganha poderes administrativos de compartilhamento nesta entrega.
PERSONAL não permite convites, renomeação familiar ou remoção de membros por esta
API. Bloqueamos qualquer remoção de OWNER, preservando pelo menos um proprietário.

## Convites

`WorkspaceInvitation` contém id, workspaceId, e-mail normalizado, role MEMBER,
tokenHash único, status, expiresAt, invitedByUserId, acceptedByUserId opcional,
acceptedAt opcional e timestamps. FKs RESTRICT preservam as referências a User e
Workspace. A migration aditiva `20261005120000_workspace_sharing` não altera nem
apaga dados financeiros.

O token usa 32 bytes criptográficos (`randomBytes`) em base64url. Apenas SHA-256 é
persistido. A resposta da criação retorna o token bruto uma única vez; listagem e
preview nunca retornam o hash. A interface mantém o link somente em memória e
permite copiá-lo ou selecioná-lo no campo de texto. Ao sair/recarregar, use o link
já copiado; se o perdeu, cancele o convite e gere outro. Não há envio automático
de e-mail. Um adaptador de envio poderá consumir o token no momento de criação
futuramente, sem persistir o segredo.

Validade: sete dias, centralizada em `INVITATION_TTL_MS`. Estados: PENDING,
ACCEPTED, CANCELLED, EXPIRED e DECLINED. A expiração é verificada pelo horário do
servidor; a atualização de status ocorre de forma lazy na listagem/criação/aceite.
O preview calcula a expiração sem conceder acesso ou exigir cron.

E-mails são aparados e normalizados para minúsculas. Auto-convite e usuários já
membros são bloqueados. Um índice SQL parcial garante um único PENDING por
workspace/e-mail. Criações concorrentes reutilizam o convite válido existente,
sem recuperar ou regenerar seu token. Convites expirados são encerrados antes de
permitir nova criação. Os CHECKs e o índice parcial são mantidos manualmente na
migration, pois não são expressos integralmente pelo schema Prisma.

## Aceite e autenticação

`/invite/:token` mostra somente nome do workspace, nome de quem convidou, status e
expiração. Não divulga e-mail do destinatário nem situação cadastral. Abrir o link
não cria membership. Sem sessão, a pessoa pode entrar ou criar conta. O parâmetro
`next` preserva exclusivamente a rota local de convite; URLs externas e outros
caminhos são rejeitados. O cadastro inclui esse retorno no link de confirmação.
O Supabase deve permitir os URLs de retorno `/login` com query string do ambiente
usado e manter confirmação de e-mail habilitada para comprovar posse do endereço.

Depois do login, o destinatário confirma explicitamente Aceitar ou Recusar. A API
compara o e-mail da identidade verificada pelo JWT com o convite. E-mail diferente
recebe: “Este convite foi enviado para outro endereço de e-mail.” A pessoa pode
ser cadastrada depois da emissão do convite; só precisa autenticar com o mesmo
endereço. Nunca se vincula uma conta por um e-mail enviado no corpo da requisição.

Aceite serializa a operação por workspace em transação: valida estado/expiração,
cria uma membership MEMBER e marca ACCEPTED com usuário/data. O unique existente
(workspaceId, userId) também impede duplicatas. Aceites simultâneos ou repetidos
pelo mesmo usuário já membro retornam sucesso consistente. Um token aceito não
adiciona outra pessoa nem readmite quem foi removido posteriormente. Cancelamento
pelo OWNER gera CANCELLED; recusa pelo destinatário gera DECLINED.

## Remoção e revogação

Remover MEMBER apaga apenas WorkspaceMember. Campos opcionais ownerMemberId de
Account, CreditCard e Transaction são limpos na mesma transação para respeitar as
FKs compostas. O User, os valores e createdBy (FK para User) permanecem intactos.
Autoria não foi remodelada nem adicionamos infraestrutura de auditoria.

O WorkspaceGuard consulta membership em toda requisição; a próxima chamada após
remoção falha mesmo com JWT válido e UUID conhecido. Operações já autorizadas em
andamento seguem suas transações e constraints usuais. Não há cache de autorização
nem dependência de logout, ACL por recurso ou lock global de todas as finanças.

Após criar FAMILY/aceitar, a interface atualiza `/me` e seleciona o novo workspace.
No foco da janela ou após 403 de uma requisição com workspace, atualiza memberships.
Se o workspace ativo foi revogado, escolhe um workspace ainda permitido e remonta
a área financeira, descartando os dados da tela anterior. Não usamos websocket;
sem interação/foco, uma tela já carregada pode permanecer visível até a atualização.

## Endpoints

Todos os endpoints administrativos com `:workspaceId` exigem Bearer token,
`X-Workspace-Id` coincidente e membership. OWNER/FAMILY são revalidados na transação.

| Método e rota                                               | Acesso / resultado                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /workspaces`                                          | Autenticado; `{name,type:"FAMILY"}` → OWNER                         |
| `PATCH /workspaces/:workspaceId`                            | OWNER; `{name}`                                                     |
| `GET /workspaces/:workspaceId/members`                      | Membro; id da membership, userId, nome, e-mail, role, joinedAt      |
| `DELETE /workspaces/:workspaceId/members/:memberId`         | OWNER; remove somente MEMBER                                        |
| `GET /workspaces/:workspaceId/invitations`                  | OWNER; metadados sem hash/token                                     |
| `POST /workspaces/:workspaceId/invitations`                 | OWNER; `{email,role?:"MEMBER"}` → invitation, token ou null, reused |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | OWNER; cancela PENDING                                              |
| `GET /invitations/:token`                                   | Público; preview mínimo                                             |
| `POST /invitations/:token/accept`                           | Destinatário autenticado; aceite explícito                          |
| `POST /invitations/:token/decline`                          | Destinatário autenticado; recusa explícita                          |

Falhas de autorização usam 403; entidades não encontradas no workspace, 404;
entrada inválida, 400; conflito de estado/duplicidade de membro, 409. Token inválido
não revela informações de contas. Não logar corpos de criação nem URLs de convite
em futuros loggers/proxies. A Web usa referrer policy `no-referrer`.

## Validação e limitações

`apps/api/test/sharing.integration.mjs` exercita API HTTP com JWTs assinados,
PostgreSQL real, concorrência de criação/aceite, usuários futuros, isolamento,
revogação e preservação de autoria/valores. Fixtures têm IDs exclusivos e são
removidas ao terminar. `prisma/tests/integrity.sql` valida CHECKs, FK e índice
parcial dentro de transação revertida. Testes Web cobrem permissões, criação,
cópia/cancelamento, remoção confirmada, convite público, aceite/recusa, retorno
seguro e atualização do seletor após revogação.

Comandos: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm format:check`,
`pnpm db:validate`, `pnpm test:database`, `pnpm db:test`.

Ficam para evolução: e-mail transacional, transferência de OWNER, permissões
avançadas, exclusão do workspace, auditoria detalhada e cartões privados em FAMILY.
Não foi criado rate limiter novo: tokens têm 256 bits de entropia e preview não
expõe cadastro. Dashboard preservado na FIN-11; compartilhamento é a FIN-10.

## Resultado da validação — 05/10/2026

Todos os comandos acima passaram: 48 testes de API, 98 testes Web e 85 testes de
integração PostgreSQL. A suíte SQL exercitou 14 modelos com ROLLBACK. Incluído teste
de remoção concorrente com criação financeira: operação previamente autorizada
pode concluir, enquanto novas chamadas são negadas após remoção.

No Chromium, dois contexts independentes representaram Arthur e Maria. O teste
usou API e banco reais locais, com provedor de identidade simulado por JWTs
assinados de teste; não enviou mensagens nem criou contas no Supabase externo.
Arthur criou FAMILY, copiou o convite, Maria entrou pelo link e aceitou. Ambos
consultaram os mesmos recursos. Maria criou “Mercado — R$ 350” pela interface;
Arthur visualizou o lançamento. Após remoção, o registro/autoria permaneceram e
a próxima requisição de Maria recebeu 403, atualizando o seletor para Pessoal.
Fixtures foram removidas ao terminar.

Inspeção visual em 1440×1000, 820×1180 e 390×844: sem overflow horizontal ou erros
inesperados no console. O 403 provocado para testar revogação é esperado.
Evidências: [desktop](screenshots/fin10-desktop.png),
[tablet](screenshots/fin10-tablet.png), [celular](screenshots/fin10-mobile.png).
O envio/confirmação de e-mail real pelo Supabase não foi exercitado no navegador;
o retorno é coberto por testes Web e o login pelo convite foi exercitado com o SDK.

Avisos não bloqueantes já existentes: bundle Web acima de 500 kB e depreciação de
consultas simultâneas no driver `pg`. Nenhuma dependência de produção foi adicionada.
