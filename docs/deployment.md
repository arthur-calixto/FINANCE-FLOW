# Deploy — FIN-12

## Estado atual

A produção local já está executando Web/API/Proxy em Docker e utiliza PostgreSQL e Auth do Supabase. As seis migrations foram aplicadas anteriormente pelo operador. A operação diária agora usa `finance-flow.sh`, preservando o Compose, as portas e o banco remoto existentes. O desenvolvimento continua independente.

O checkpoint da preparação inicial da FIN-12 foi superado conforme informado pelo operador. Isso não equivale a afirmar que domínio HTTPS público, e-mails, backups e todos os smoke tests remotos foram validados; confirmar esses itens antes da publicação na Internet.

## Arquitetura

```text
Browser → HTTPS/Nginx proxy → /      → Nginx Web (Vite compilado)
                           → /api/ → NestJS:3000 → Supabase PostgreSQL
Browser → Supabase Auth               NestJS → Auth JWKS
```

`docker-compose.yml` continua exclusivo do desenvolvimento, com PostgreSQL local. `docker-compose.production.yml` contém Web, API, proxy e um job `migrate` no profile `migration`, sem PostgreSQL. A rede bridge conecta os serviços e permite saída para Supabase; apenas o proxy publica portas. Não há volumes financeiros nem dependência de caminhos, IPs ou distribuição Linux particulares.

API e job usam Node 22 LTS com OpenSSL/CA. Builds multistage respeitam o lockfile e pnpm 10.34.5. A API recebe um pacote portátil com dependências de produção via `pnpm deploy --prod --no-optional --offline`, com injeção de workspace habilitada somente no comando de empacotamento e snapshots do lockfile; o job separado contém CLI Prisma e suas dependências. Nenhuma migration é executada na inicialização da API. Todos os runtimes usam usuário não-root.

Web usa Nginx, não Vite dev/preview. `/app`, `/app/transactions`, `/app/settings` e `/app/credit-cards` têm fallback para `index.html`; assets inexistentes retornam 404. A API continua com rotas sem prefixo internamente: o proxy remove `/api/`.

## Variáveis e secrets

Copiar `.env.production.example` para `.env.production`, com permissão `chmod 600 .env.production`. Preencher localmente; não enviar connection strings na conversa. `.env.production` e `deploy/secrets/` são ignorados pelo Git e pelo contexto Docker.

| Variável                         | Momento                 | Uso                                                            |
| -------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`                   | Runtime API             | Conexão PostgreSQL; segredo                                    |
| `DIRECT_URL`                     | Job Prisma              | Conexão direta ou session pooler para migrations; segredo      |
| `SUPABASE_URL`                   | Runtime API             | Project URL; deriva issuer e JWKS                              |
| `VITE_SUPABASE_URL`              | Build Web               | Mesmo projeto Auth; público                                    |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | Build Web               | Chave publishable pública; nunca service role/secret key       |
| `VITE_API_URL`                   | Build Web               | Fixada como `/api` no Dockerfile                               |
| `WEB_ORIGIN`                     | Runtime API             | Origens exatas separadas por vírgula, opcional em mesma origem |
| `IMAGE_TAG`                      | Compose                 | Tag das imagens locais, padrão `local`                         |
| `HTTP_BIND` / `HTTP_PORT`        | Compose                 | Bootstrap HTTP local em `127.0.0.1:8080`                       |
| `HTTPS_PORT`                     | Override HTTPS          | Porta publicada TLS, padrão 443                                |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | Override HTTPS          | Caminhos locais de fullchain e chave privada                   |
| `DB_CA_FILE`                     | Override TLS PostgreSQL | Caminho local da CA, se necessária                             |

`API_PORT` é fixada em 3000 internamente no Compose para coincidir com proxy/healthcheck; não é publicada. Alterações em `VITE_*` exigem rebuild/recriação de Web. Alterações nas variáveis de API exigem recriação do container, não apenas `restart`. Nunca passar URLs de banco como build args. `docker compose config` sem `--quiet` e `docker inspect` podem mostrar secrets: não compartilhar suas saídas.

Em desenvolvimento, continuam permitidas `localhost:5173` e `127.0.0.1:5173`, além de `WEB_ORIGIN` para LAN. Em produção, não há origens locais implícitas nem wildcard CORS. Mesma origem `/api` dispensa allowlist; configurar `WEB_ORIGIN` somente se realmente necessário.

## Prisma 7 e Supabase

Prisma CLI 7.10 lê `process.env.DIRECT_URL || DATABASE_URL` em `prisma.config.ts`. O runtime `PrismaPg` continua lendo exclusivamente `DATABASE_URL`. Dev sem `DIRECT_URL` mantém seu comportamento. Não existe campo legado `directUrl` no datasource do schema.

A configuração atual do operador utiliza **Transaction Pooler na porta 6543 em DATABASE_URL** e **Session Pooler na porta 5432 em DIRECT_URL**. Essa estratégia foi preservada. O job Prisma usa a conexão de sessão para migrations; a API usa seu pooler de runtime. Copiar strings reais do painel Connect, sem inventar host/usuário ou compartilhar senhas. Confirmar limites do plano antes de aumentar réplicas. A recomendação anterior de evitar transaction pooler era da fase de preparação e não descrevia o ambiente funcional atual.

Referências: [Prisma Config v7](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [Prisma no Supabase](https://supabase.com/docs/guides/database/prisma) e [pnpm deploy](https://pnpm.io/10.x/cli/deploy).

### TLS do banco

Não desabilitar validação de certificado. Para o driver `pg` do runtime, configurar `sslmode=verify-full`; se o endpoint exigir a CA do projeto, baixar a CA no painel e usar `sslrootcert=/run/certs/database-ca.crt`. O override `docker-compose.database-tls.yml` monta somente esse arquivo, como leitura, em API e job.

O CLI Prisma usa parâmetros próprios do conector PostgreSQL: na `DIRECT_URL`, configurar `sslmode=require&sslaccept=strict` e, quando necessária a CA, `sslcert=/run/certs/database-ca.crt`. Não confundir `sslcert` desse conector com certificado de cliente do libpq. Senha deve estar corretamente percent-encoded. A validação inicial de infraestrutura não verificou TLS do banco remoto; a configuração atual de conexão deve ser mantida e revisada pelo operador sem desabilitar verificação de certificado.

Não usar `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized:false` ou `sslaccept=accept_invalid_certs`. Falhas de CA/hostname devem ser corrigidas na configuração. [Conector PostgreSQL Prisma](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql).

### Schema e acesso por Data API

O histórico atual cria as tabelas do FINANCE FLOW em `public`. Não gerencia `auth.users`, `storage` ou outros schemas internos. A autorização por Workspace está no NestJS, não em políticas RLS dessas tabelas.

**Proteção do ambiente remoto:** conferir se o projeto é dedicado e desabilitar a Data API, que o produto não utiliza, para impedir acesso direto às tabelas existentes. Se outros sistemas dependem da Data API, parar e definir uma estratégia de schemas/permissões antes de migrar. Não deixar as tabelas financeiras expostas por REST/GraphQL contornando a API NestJS. Essa configuração não foi alterada nesta fase. [Orientação oficial](https://supabase.com/docs/guides/api/securing-your-api).

## Auditoria reproduzível local

Após `pnpm install --frozen-lockfile` e `pnpm build`:

```sh
pnpm db:test:fresh
```

O script cria um PostgreSQL 17 com nome aleatório, armazenamento tmpfs, senha efêmera e porta aleatória vinculada apenas a loopback. Sobrescreve explicitamente `DATABASE_URL` e `DIRECT_URL` nos processos filhos. Não lê dados nem reaplica migrations no banco principal. Ao terminar, encerra somente seu próprio container descartável.

Executa as seis migrations em ordem, verifica no catálogo todos os nomes de tabelas/enums/índices/constraints declarados no histórico, compara banco e schema com `migrate diff --exit-code`, executa `prisma validate`, integridade SQL e `pnpm test:database`. Erro interrompe a sequência; nenhuma correção automática de histórico é feita.

| Migration                             | Auditoria                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `20260928180702_database_schema_v1`   | 11 tabelas iniciais, 8 enums, índices, FKs RESTRICT e CHECKs manuais; `gen_random_uuid()` nativa no PostgreSQL 17 |
| `20260928190000_supabase_identity`    | `authUserId` opcional/único; sem FK nem alteração de `auth.users`                                                 |
| `20260929130000_invoice_payment`      | Colunas de pagamento, FK composta de workspace e CHECKs; aditiva                                                  |
| `20260929223000_recurrences`          | Revision e identidade de ocorrência; backfill é vazio em banco novo; duplicatas legadas falham sem apagar dados   |
| `20260930122000_transaction_deletion` | Início do parcelamento com backfill e CHECK, exclusões de recorrência; sem DELETE de dados                        |
| `20261005120000_workspace_sharing`    | Convites, enum, FKs, CHECKs de convite e índice único parcial para pendentes                                      |

Resultado esperado: **14 models e 9 enums**, além de `_prisma_migrations`. Os CHECKs e o índice parcial são SQL manual e precisam permanecer nas migrations; a comparação Prisma sozinha não substitui os testes de integridade. Regras entre entidades documentadas no domínio continuam sob responsabilidade dos serviços e seus testes; esta task não acrescenta regras financeiras nem altera migrations históricas.

## Build e teste dos containers sem Supabase

O smoke local requer Docker Compose, Node/pnpm e OpenSSL no host. Somente para construir imagens de teste, usar valores públicos fictícios. As URLs de banco abaixo são fixtures locais, não credenciais reais:

```sh
env DATABASE_URL=postgresql://fixture:fixture@postgres:5432/fixture \
  DIRECT_URL=postgresql://fixture:fixture@postgres:5432/fixture \
  SUPABASE_URL=https://example.supabase.co \
  VITE_SUPABASE_URL=https://example.supabase.co \
  VITE_SUPABASE_PUBLISHABLE_KEY=public-local-build-fixture \
  docker compose --env-file /dev/null -f docker-compose.production.yml --profile migration build
pnpm test:docker
```

O smoke cria um projeto Compose aleatório, PostgreSQL temporário sem porta publicada e emissor JWKS local de teste. Aplica migrations com a imagem do job, verifica SPA, health, 401 sem JWT, JWT validado por JWKS, bootstrap PERSONAL, Dashboard e identidade preservada após restart. Só o proxy publica uma porta aleatória em loopback. Também gera um certificado descartável com OpenSSL e valida o override HTTPS com confiança explícita nessa CA, sem desabilitar verificação TLS. Ao finalizar, encerra apenas esse projeto. O emissor JWKS é um container adicional isolado na rede de teste, sem porta publicada, e contém apenas chaves públicas de teste. Nenhum usuário real é criado no Supabase. O smoke não substitui confirmação de e-mail, recuperação e demais fluxos reais após o deploy.

## Servidor Linux novo

1. Instalar Docker Engine e plugin Compose conforme a distribuição; obter este repositório. Não é necessário Node/pnpm no host para executar as imagens.
2. Configurar `.env.production`, endpoint/CA PostgreSQL, projeto Auth e as proteções da Data API. Confirmar projeto, banco, schema e tabelas existentes antes de aplicar migrations. Havendo objetos inesperados/conflitos, parar sem apagar nada.
3. Definir domínio/DNS, acesso externo do servidor e certificado válido (ACME ou mecanismo escolhido pelo operador). Não foi automatizada emissão/renovação nesta task. Após renovar certificados, reiniciar o proxy para carregar os novos arquivos. Servidor residencial pode precisar de NAT/firewall e pode estar sob CGNAT.
4. Configurar `TLS_CERT_FILE`, `TLS_KEY_FILE`, `HTTP_BIND=0.0.0.0`, `HTTP_PORT=80` e `HTTPS_PORT=443`. Guardar a chave fora do Git e permitir leitura somente ao usuário necessário do Nginx no container. O override HTTPS redireciona HTTP e termina TLS no próprio proxy; não depende de headers de um proxy externo.
5. Usar a função abaixo para todos os comandos. Adicionar `-f docker-compose.database-tls.yml` se for preciso montar CA, configurando `DB_CA_FILE`.

```sh
dc() {
  docker compose --env-file .env.production \
    -f docker-compose.production.yml -f docker-compose.https.yml "$@"
}
dc --profile migration config --quiet
dc --profile migration build
```

Sem registry nesta fase: `build` gera `finance-flow-api`, `finance-flow-web` e `finance-flow-migrate`. Usar uma tag de release por `IMAGE_TAG` para facilitar rastreabilidade. Atualizar/revalidar imagens-base e pacotes de sistema periodicamente.

**Somente depois de confirmar o banco alvo e as migrations que serão publicadas:**

```sh
dc --profile migration run --rm --no-deps migrate \
  node node_modules/prisma/build/index.js migrate status
dc --profile migration run --rm --no-deps migrate
dc up -d --wait
```

O comando padrão do job é `prisma migrate deploy`. Um banco novo pode retornar status de migrations pendentes antes do deploy; isso não autoriza reset. Nunca usar `migrate dev`, `db push` ou reset em produção. Não executar a suíte de integração local no Supabase: ela manipula fixtures e é restrita a loopback.

## Operação

Com a função `dc` acima:

```sh
dc ps
dc logs -f
dc logs -f api
dc logs -f web
dc restart
dc stop
dc up -d --wait
# Somente quando uma parada do ambiente for intencional:
dc down
dc up -d --wait
```

Recriar containers não perde dados remotos. Configurar retenção/rotação de logs no Docker do servidor. API e Nginx escrevem stdout/stderr; access logs omitem query strings e ocultam tokens nas rotas de convite. Não adicionar logging de Authorization, senhas, corpos de autenticação ou connection strings.

`GET /api/health` pelo proxy (internamente `GET /health`) retorna `{"status":"ok"}`. É **liveness**, não prova conexão com banco/JWKS. Healthcheck do Web verifica seu servidor estático; o do proxy verifica o Nginx. API recebe SIGTERM diretamente por Node com init e preserva shutdown hooks/fechamento Prisma. Validar operações autenticadas para readiness funcional. Limite de body 1 MiB, conexão upstream 5 s e leitura/envio 60 s. DNS dos upstreams é reconsultado para suportar recriação dos containers.

## Supabase Auth e primeiro acesso

`SUPABASE_URL` e `VITE_SUPABASE_URL` precisam apontar ao mesmo projeto. O backend deriva `${SUPABASE_URL}/auth/v1` como issuer e `.../auth/v1/.well-known/jwks.json` como JWKS; não há variável duplicada para JWKS e nenhuma service role key é necessária. Preservar chaves de assinatura compatíveis com ES256/RS256.

Configurar **Site URL** com a origem HTTPS publicada. Em **Redirect URLs**, permitir os destinos reais `/login` (confirmação de cadastro) e `/reset-password` (recuperação). O cadastro com convite constrói `/login?next=` com `/invite/<token>` codificado: adicionar uma regra restrita à origem e `/login?next=**`, conforme os padrões aceitos pelo painel, e testar o link enviado. A aplicação preserva o retorno seguro para `/invite/:token` após login/cadastro. `/register` e `/forgot-password` são páginas locais; não são callbacks novos. Manter URLs localhost de dev separadas quando o mesmo projeto Auth for compartilhado. Referência: [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

Primeiro usuário: cadastro/confirmação/login reais → JWT → `/me` → User interno e PERSONAL/OWNER. Não inserir usuário fake no banco publicado. Depois criar FAMILY e testar convite/aceite com a identidade convidada.

## Smoke da segunda fase, ainda pendente

Após publicação HTTPS autorizada: cadastro, confirmação, login/logout e recuperação; PERSONAL/FAMILY, convite/aceite OWNER/MEMBER/remoção; conta, categoria, receita/despesa/pagamento, recorrência, parcelamento, cartão/compra/fatura e todos os blocos do Dashboard. Usar dados de validação explicitamente identificados e coordenar sua permanência/remoção com o usuário.

Conferir desktop/tablet/celular no domínio real, incluindo refresh, convite e configurações. Reiniciar containers e, se autorizado/seguro, executar down/up verificando mesmos usuários/workspaces/dados. Testes locais não comprovam DNS, certificado público, e-mail, plano Supabase ou persistência do ambiente remoto.

## Backup e portabilidade

O plano do projeto ainda não foi informado. Segundo a [documentação oficial de backups](https://supabase.com/docs/guides/platform/backups), Pro tem 7 dias de backups diários; Team 14 e Enterprise até 30. Para Free, a recomendação é exportar e guardar backups externos; não presumir retenção/restauração garantida. PITR é uma opção adicional dos planos elegíveis. Confirmar recursos efetivamente habilitados no painel antes de dados reais.

Antes de uso real, definir responsável, frequência, destino externo criptografado e teste de restauração em ambiente separado. Backup diário pode perder alterações do período entre cópias; a cópia externa reduz dependência da conta/projeto. Automatização completa fica para outra task. Projetos Free também podem ser [pausados por baixa atividade](https://supabase.com/docs/guides/platform/free-project-pausing).

Para VPS futura: instalar Docker, copiar código/configuração privada e certificados com segurança, reconstruir as imagens, ajustar DNS/firewall e iniciar o mesmo Compose. PostgreSQL permanece externo; não transportar dados financeiros nos containers.

## Troubleshooting

- `502`: conferir saúde/logs da API/Web, resolução da rede Compose e variáveis; não publicar 3000 para contornar proxy.
- `401`: conferir projeto/issuer/JWKS, expiração, assinatura e relógio do host. Não colar JWT nos logs.
- Erro TLS PostgreSQL: conferir CA, hostname e parâmetros específicos do driver/CLI; não desativar verificação.
- Erro de rede PostgreSQL: conferir IPv6, session pooler IPv4 e regras de saída; não inventar host/porta.
- Web continua com configuração antiga: rebuild de Web e recriação; variáveis Vite são build-time.
- Refresh 404: conferir configuração Nginx da SPA e mount correto do proxy.
- Certificado HTTPS sem leitura: conferir proprietário/permissões para o usuário nginx, sem tornar chave privada pública.
- Migration incompatível: parar e relatar migration/erro/estado observado; não resetar nem editar histórico aplicado.

## Validação da primeira fase

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm format:check` e `pnpm db:validate`: aprovados.
- API: 48 testes; Web: 111 testes. `pnpm test:database`, executado pelo teste de reconstrução isolado: 99 testes aprovados.
- `pnpm db:test:fresh`: seis migrations do zero, sem divergência Prisma; catálogo com 14 tabelas, 9 enums, 55 índices explicitamente criados e 76 constraints validadas (incluem PKs/FKs/CHECKs). Índices das PKs são adicionais aos 55 explicitamente declarados.
- `pnpm db:test`: integridade dos 14 models aprovada em transação com rollback.
- Compose config/build e `pnpm test:docker`: imagens de API/Web/job, proxy, bootstrap JWT/JWKS local, Dashboard, restart, CORS de produção sem allowlist local e HTTPS local verificado.
- Navegador automatizado externo ao monorepo: Dashboard e refresh de lançamentos/cartões/configurações em 1440, 768 e 390 px, sem erros JavaScript nem overflow horizontal nas páginas verificadas. Sessão/Auth simulados; dados financeiros lidos pela API real dos containers.
- Não houve alteração de migrations históricas, banco Supabase, credenciais, schema Auth ou dados de desenvolvimento. Nenhum commit foi feito.

Warnings existentes: bundle Web acima de 500 kB e aviso do driver `pg` sobre consultas concorrentes no mesmo client. Sem falhas nessas suítes. TLS/CA do PostgreSQL Supabase, e-mails reais, domínio público e plano de backup permanecem pendentes da segunda fase. Os certificados do teste Docker são efêmeros e não servem para publicação.

## Checkpoint inicial (histórico)

A preparação inicial parou antes de migrations remotas. Posteriormente, o operador informou a aplicação das seis migrations no Supabase e autorizou o comando administrativo `migrate` a executar exclusivamente `migrate deploy`, seguido de `migrate status`. O script não altera schema por outros mecanismos nem modifica registros financeiros.

## Operação diária

O script resolve a raiz pelo seu próprio caminho e usa exclusivamente `.env.production` e `docker-compose.production.yml`. Pode ser chamado por caminho absoluto a partir de qualquer diretório. Pré-requisitos: Bash, Docker Engine com Compose v2 (suporte a `up --wait` e `config --format json`), Python 3, curl e flock (util-linux). Python usa apenas biblioteca padrão para interpretar JSON e filtrar saída; não instala dependências.

```sh
chmod +x finance-flow.sh
./finance-flow.sh help
./finance-flow.sh config
./finance-flow.sh start
./finance-flow.sh status
./finance-flow.sh health
./finance-flow.sh logs
./finance-flow.sh logs api
./finance-flow.sh logs web
./finance-flow.sh logs proxy
./finance-flow.sh restart
./finance-flow.sh stop
./finance-flow.sh start
```

`start` usa imagens existentes, aguarda saúde por até 120 segundos e testa `/healthz` e `/api/health` pelo proxy. Não faz build nem migration. `stop` para sem remover containers. `restart` reinicia sem migrar ou atualizar imagens/variáveis; para publicar mudanças de configuração, usar `update`. `status` inclui containers parados, saúde e portas. `logs` acompanha as últimas 200 linhas; Ctrl+C encerra apenas a visualização. Serviços aceitos são somente api, web e proxy; argumentos extras são rejeitados.

`health` descobre a porta realmente publicada pelo Compose. Para binds `0.0.0.0` e `::`, usa respectivamente `127.0.0.1` e `::1`, sem depender da LAN. Exige HTTP 200 nos dois endpoints e JSON `{"status":"ok"}` na API. É liveness da aplicação, não uma transação de banco nem validação de login. Não segue redirects nem desativa TLS. Esta primeira versão administra o Compose HTTP principal; os overrides opcionais HTTPS/CA não são incluídos automaticamente. Se futuramente forem usados em produção, adaptar explicitamente o wrapper antes de operar aquele ambiente.

`config` valida sem imprimir o Compose interpolado. Pré-requisitos, variáveis obrigatórias e daemon são verificados antes das operações. O script não executa `source`/`eval` no arquivo de ambiente. Exportações de variáveis usadas no Compose são removidas do processo filho para que um terminal de desenvolvimento não sobrescreva `.env.production`. Isso não altera o shell do operador.

Saídas de Compose/build/Prisma/logs passam por filtro de connection strings, valores sensíveis configurados, senhas decodificadas, Bearer e JWT. O filtro é defesa adicional, não autorização para a aplicação registrar secrets desconhecidos. A configuração resolvida é processada em diretório temporário privado, criado com umask 077 e removido ao terminar; nenhum valor é escrito no repositório. Não usar `bash -x` nem compartilhar comandos Compose brutos com configuração interpolada.

Operações que alteram containers/imagens/migrations são serializadas por `flock` em `.finance-flow.lock` (ignorado pelo Git/Docker). Isso protege chamadas deste script, não comandos Docker executados por fora. Falhas retornam código diferente de zero; comando/argumento inválido retorna 2. Nenhum comando remove volumes ou faz `down`, reset ou SQL manual. `.env.production` e chaves privadas continuam ignorados.

### Retorno após reboot

API/Web/Proxy continuam com `restart: unless-stopped`. Se estavam rodando, voltam quando o daemon Docker inicia após reboot. Containers parados deliberadamente por `stop` permanecem parados até `start`; containers removidos não são recriados pela policy. Healthcheck `unhealthy` sozinho não dispara restart: a policy atua quando o processo termina. O Docker precisa estar habilitado no boot (`systemctl is-enabled docker`); nesta máquina está `enabled`. Não foi adicionado um serviço systemd da aplicação nem realizado reboot para testar. [Documentação Docker](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Publicação de nova versão

Disponibilizar o código no servidor pelo procedimento escolhido pelo operador. O script **não executa git pull**, checkout ou commit.

```sh
./finance-flow.sh update
```

Fluxo exato:

1. Validar arquivos, ferramentas, daemon, variáveis e Compose; adquirir lock exclusivo.
2. Mostrar commit curto atual quando Git estiver disponível e avisar se houver alterações locais.
3. Construir API, Web **e a imagem migrate**, mantendo os containers atuais em execução.
4. Aplicar exclusivamente `prisma migrate deploy` pelo serviço migrate/profile migration, sem dependências e usando a imagem já construída.
5. Executar `prisma migrate status`; qualquer falha interrompe a publicação.
6. Executar `up -d --no-build --force-recreate --wait --wait-timeout 120 api web proxy`.
7. Testar Proxy/API pelo HTTP local, exibir `ps` e informar sucesso.

Se build falhar, nenhum container é recriado e nenhuma migration começa. Se deploy/status de migrations falhar, não há recriação da aplicação. Se os containers ou endpoints falharem depois da troca, o comando retorna erro e orienta consultar logs; pode haver indisponibilidade e o script não faz rollback automático. Migrações já aplicadas não são revertidas. As migrations futuras devem ser compatíveis com a versão anterior enquanto ela atende durante a atualização; validar backup e impacto antes da publicação. O deploy não é atômico nem zero-downtime.

Comandos separados:

```sh
./finance-flow.sh build          # constrói as três imagens, sem subir/migrar
./finance-flow.sh migrate        # deploy + status; usa a imagem já construída
./finance-flow.sh migrate-status # somente status, sem aplicar migrations
```

Após obter novas migrations, executar `build` antes de `migrate` ou preferir `update`, que garante a ordem. `migrate` não pede confirmação interativa: sua execução explícita autoriza a aplicação das migrations existentes naquela imagem. Não cria migrations de teste nem copia dados de desenvolvimento.

### Testes do operador

```sh
bash -n finance-flow.sh
python3 -m unittest discover -s scripts/tests -v
```

A suíte usa cópias temporárias, Docker/curl simulados e credentials fictícias. Cobre ajuda, argumentos inválidos, `.env.production` ausente, configuração/daemon inválidos, saúde, exclusão mútua, filtragem de secrets, Ctrl+C em logs e abortos de update por falhas de build/deploy/status/recriação. Nenhum teste simulado acessa o Supabase ou substitui o arquivo real de ambiente.

Resultados desta implementação: 13 testes isolados aprovados; `bash -n` e `pnpm format:check` aprovados. Na produção existente foram testados `config`, `status`, `health`, `start → stop → start`, `restart`, `build` e `migrate-status`. O Prisma confirmou seis migrations e schema atualizado. Logs foram iniciados a partir de outro diretório e interrompidos com SIGINT (Ctrl+C equivalente), mantendo os containers saudáveis. O fluxo `update` e suas falhas foram testados com simuladores; não foi necessário aplicar migrations ou recriar a produção para validar esse fluxo. Não houve alteração de registros financeiros, migrations de teste ou reboot.

Foi encontrada permissão `664` em `.env.production`; ela foi restringida a `600`, sem alterar seu conteúdo. O arquivo permanece ignorado pelo Git. Divergência documental corrigida: o texto antigo ainda descrevia o checkpoint pré-Supabase e recomendava outra seleção de pooler; agora registra a configuração funcional informada pelo operador. Compose, portas, autenticação e schema foram preservados.
