#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < prisma/tests/integrity.sql
