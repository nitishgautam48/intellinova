#!/bin/sh
# Runs once, on first start of an empty database volume.
# - pgvector for embeddings and question de-duplication
# - a dedicated role + schema for GoTrue, which runs its own migrations in "auth"
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
      CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD '${GOTRUE_DB_PASSWORD}';
    END IF;
    -- GoTrue's migrations grant on its tables to a role named "postgres".
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
      CREATE ROLE postgres NOLOGIN;
    END IF;
  END
  \$\$;

  CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
  GRANT CREATE, CONNECT ON DATABASE ${POSTGRES_DB} TO supabase_auth_admin;
  ALTER ROLE supabase_auth_admin SET search_path = auth;
EOSQL
