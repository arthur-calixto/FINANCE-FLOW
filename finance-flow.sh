#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$ROOT_DIR"
OPS="$ROOT_DIR/scripts/finance_flow_ops.py"
SERVICES=(api web proxy)
COMPOSE=(docker compose --project-directory "$ROOT_DIR" --env-file "$ROOT_DIR/.env.production" -f "$ROOT_DIR/docker-compose.production.yml")

help() {
  cat <<'HELP'
Uso: ./finance-flow.sh <comando>
start           Sobe o FINANCE FLOW
stop            Para os containers sem removê-los
restart         Reinicia os serviços
status          Mostra estado, health e portas
logs [serviço]  Acompanha logs (api, web ou proxy); Ctrl+C encerra só a visualização
build           Reconstrói API, Web e imagem de migrations
migrate         Aplica migrations de produção e verifica status
migrate-status  Consulta o estado das migrations
health          Testa Proxy e API
config          Valida a configuração sem exibir secrets
update          Publica a versão atual do código (sem git pull)
help            Mostra esta ajuda
HELP
}
fail() { printf 'Erro: %s\n' "$1" >&2; exit 1; }
command_name="${1:-help}"
case "$command_name" in
  help|-h|--help) help; exit 0 ;;
  start|stop|restart|status|build|migrate|migrate-status|health|config|update)
    if (( $# != 1 )); then help; exit 2; fi ;;
  logs)
    if (( $# > 2 )); then help; exit 2; fi
    case "${2:-}" in ''|api|web|proxy) ;; *) help; exit 2 ;; esac ;;
  *) help; exit 2 ;;
esac

for program in docker python3; do
  command -v "$program" >/dev/null || fail "Pré-requisito ausente: $program"
done
[[ -f .env.production ]] || fail 'Arquivo .env.production não encontrado.'
[[ -f docker-compose.production.yml ]] || fail 'Arquivo docker-compose.production.yml não encontrado.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose indisponível.'
docker info >/dev/null 2>&1 || fail 'Daemon Docker inacessível. Confira o serviço e as permissões.'
# The production env file is authoritative, not exports from a dev shell.
while IFS= read -r variable_name; do
  [[ -z "$variable_name" ]] || unset "$variable_name"
done < <(python3 "$OPS" variables < docker-compose.production.yml)
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES

umask 077
OPS_TMP="$(mktemp -d)"
trap 'rm -rf -- "$OPS_TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'failure_code=$?; printf "Falha em %s. Consulte ./finance-flow.sh logs; nenhuma reversão automática foi executada.\n" "$command_name" >&2; exit "$failure_code"' ERR
raw_dc() { "${COMPOSE[@]}" "$@"; }
# Error output can contain interpolation values: never echo it directly.
if ! raw_dc --profile migration config --format json > "$OPS_TMP/config" 2> "$OPS_TMP/error"; then
  python3 "$OPS" config-error < "$OPS_TMP/error"
fi
python3 "$OPS" prepare < "$OPS_TMP/config" > "$OPS_TMP/redactions"
rm -- "$OPS_TMP/config" "$OPS_TMP/error"
dc() { raw_dc "$@" 2>&1 | python3 "$OPS" redact "$OPS_TMP/redactions"; }

case "$command_name" in
  start|restart|health|update) command -v curl >/dev/null || fail 'Pré-requisito ausente: curl' ;;
esac
case "$command_name" in
  start|stop|restart|build|migrate|update)
    command -v flock >/dev/null || fail 'Pré-requisito ausente: flock (util-linux)'
    exec 9> "$ROOT_DIR/.finance-flow.lock"
    flock -n 9 || fail 'Outra operação administrativa está em execução.' ;;
esac

status() { dc ps --all "${SERVICES[@]}"; }
health() {
  local base_url http_code result=0
  if ! raw_dc port proxy 8080 > "$OPS_TMP/port" 2>/dev/null || ! base_url="$(python3 "$OPS" url < "$OPS_TMP/port")"; then
    printf 'Proxy: FAIL\nAPI: FAIL\nProxy sem porta publicada disponível.\n'
    return 1
  fi
  http_code="$(curl --noproxy '*' --silent --connect-timeout 3 --max-time 8 --output "$OPS_TMP/proxy-body" --write-out '%{http_code}' "$base_url/healthz")" || http_code=000
  if [[ "$http_code" == 200 ]]; then printf 'Proxy: OK\n'; else printf 'Proxy: FAIL\n'; result=1; fi
  http_code="$(curl --noproxy '*' --silent --connect-timeout 3 --max-time 8 --output "$OPS_TMP/api-body" --write-out '%{http_code}' "$base_url/api/health")" || http_code=000
  if [[ "$http_code" == 200 ]] && python3 "$OPS" api-health < "$OPS_TMP/api-body"; then
    printf 'API: OK\n'
  else
    printf 'API: FAIL\n'; result=1
  fi
  return "$result"
}
wait_healthy() {
  local attempt
  printf 'Aguardando healthchecks (até 120 segundos)...\n'
  for ((attempt=0; attempt<60; attempt++)); do
    if raw_dc ps --all --format json "${SERVICES[@]}" > "$OPS_TMP/status" 2>/dev/null && python3 "$OPS" healthy < "$OPS_TMP/status"; then return 0; fi
    sleep 2
  done
  printf 'Containers não ficaram saudáveis. Consulte ./finance-flow.sh logs.\n' >&2
  return 1
}
migration_status() {
  dc --profile migration run --rm --no-deps -T --pull never migrate node node_modules/prisma/build/index.js migrate status
  printf 'Schema atualizado: status Prisma aprovado.\n'
}
migrate() {
  printf 'Aplicando migrations pendentes no banco de produção (migrate deploy)...\n'
  dc --profile migration run --rm --no-deps -T --pull never migrate node node_modules/prisma/build/index.js migrate deploy
  migration_status
}
build() { dc --profile migration build api web migrate; }
start() {
  dc up -d --no-build --wait --wait-timeout 120 "${SERVICES[@]}"
  status
  health
  printf 'FINANCE FLOW saudável.\n'
}

case "$command_name" in
  config) printf 'Configuração válida. Valores secretos omitidos.\n' ;;
  status) status ;;
  health) health ;;
  logs)
    # Terminal Ctrl+C interrupts this pipeline, not the detached containers.
    if (( $# == 2 )); then
      dc logs --no-color --tail=200 -f "$2"
    else
      dc logs --no-color --tail=200 -f "${SERVICES[@]}"
    fi
    ;;
  build) build ;;
  migrate) migrate ;;
  migrate-status) migration_status ;;
  start) start ;;
  stop) dc stop "${SERVICES[@]}"; status ;;
  restart) dc restart "${SERVICES[@]}"; wait_healthy; health; status ;;
  update)
    printf 'Publicando código presente no servidor (sem git pull).\n'
    if command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      printf 'Commit atual: '; git rev-parse --short HEAD
      if [[ -n "$(git status --porcelain)" ]]; then printf 'Há alterações locais; elas serão incluídas no build.\n'; fi
    fi
    build
    migrate
    dc up -d --no-build --force-recreate --wait --wait-timeout 120 "${SERVICES[@]}"
    health
    status
    printf 'Publicação concluída: build, migrations, containers e healthchecks aprovados.\n'
    ;;
esac
