// Central env accessor. Throws at import time if required vars are missing.
// Next.js loads .env automatically; this file just narrows types + fails fast.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  OPENAI_API_KEY: required('OPENAI_API_KEY'),
  COOLIFY_BASE_URL: required('COOLIFY_BASE_URL'),
  COOLIFY_API_TOKEN: required('COOLIFY_API_TOKEN'),
  COOLIFY_PROJECT_UUID: process.env.COOLIFY_PROJECT_UUID ?? '',
  COOLIFY_SERVER_UUID: process.env.COOLIFY_SERVER_UUID ?? '',
  GITHUB_TOKEN: required('GITHUB_TOKEN'),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
};
