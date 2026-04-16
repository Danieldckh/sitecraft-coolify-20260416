#!/usr/bin/env bash
set -e
APP_UUID="r40cscswsocc4og8go8kskok"
source "$(dirname "$0")/../.env"

setenv() {
  local key="$1" value="$2"
  # escape " in value
  local v="${value//\"/\\\"}"
  curl -sS -X POST \
    -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$key\",\"value\":\"$v\"}" \
    "$COOLIFY_BASE_URL/api/v1/applications/$APP_UUID/envs" 2>&1 | head -c 200
  echo
}

setenv OPENAI_API_KEY "$OPENAI_API_KEY"
setenv COOLIFY_API_TOKEN "$COOLIFY_API_TOKEN"
setenv COOLIFY_BASE_URL "$COOLIFY_BASE_URL"
setenv COOLIFY_PROJECT_UUID "$COOLIFY_PROJECT_UUID"
setenv COOLIFY_SERVER_UUID "$COOLIFY_SERVER_UUID"
setenv GITHUB_TOKEN "$GITHUB_TOKEN"
setenv DATABASE_URL "file:./dev.db"
setenv NODE_ENV "production"
