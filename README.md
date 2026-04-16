# Sitecraft

AI-native website builder with a node-based editor, three-tier prompt hierarchy (site → page → section), GPT-4o vision for image-to-section, site-wide memory, change log, and one-click Coolify deployment.

## Quick start

```bash
npm install --legacy-peer-deps
npx prisma db push
npm run dev
```

Open http://localhost:3000/sites.

## Env

See `.env`. Required:
- `OPENAI_API_KEY`
- `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID`
- `GITHUB_TOKEN`
- `DATABASE_URL` (SQLite `file:./dev.db` by default)

## Architecture

See `C:\Users\pamde\.claude\plans\parsed-tinkering-pretzel.md` and `./research.md`.
