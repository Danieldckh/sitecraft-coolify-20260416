# Persistence — Coolify volume setup

The builder stores three categories of state that **must survive redeploys**:

| What | Where in container | Needed for |
|---|---|---|
| SQLite database (sites, pages, elements, deployments) | `/app/prisma/` | Sites grid survives redeploy, Deployment history, Theme + planJson |
| User-uploaded images | `/app/public/uploads/` | Logos, reference images, and AI-generated images referenced by the generated sites |
| Generated images (from `/api/generate-image`) | `/app/public/uploads/` (same dir) | Same as above |

Without volume mounts, a Coolify redeploy wipes all of these: existing sites disappear, uploaded images 404, and any live-hosted sites that referenced those images break.

## One-time setup (Coolify UI, ~2 min)

1. Open **https://coolify.proagrihub.com** → sign in.
2. Navigate to **Projects → (your project) → sitecraft-builder**.
3. Click the **Storage** tab in the left sidebar.
4. Add **two** persistent volumes:

| Name | Mount Path | Type |
|---|---|---|
| `sitecraft-db` | `/app/prisma` | Volume |
| `sitecraft-uploads` | `/app/public/uploads` | Volume |

5. Click **Save** on each, then click **Deploy** from the app page to apply.

Coolify will create two host-side volumes (persisted on the VPS) and mount them into the container at those paths. The Dockerfile's `CMD` already runs `prisma db push --skip-generate` on every start, so the first startup after mounting will either seed a fresh DB (new volume) or honor the existing one (if re-mounted).

## Verify it worked

After the next redeploy:
1. Build a new site on the landing.
2. Wait for it to finish.
3. Trigger another redeploy via the Coolify UI (or hit `/api/v1/deploy` via API).
4. After the redeploy lands, reload the landing page — the site you just built **should still be in the grid**.

If the site is gone: check that the volumes show as "Mounted" on the app's Storage tab and that `DATABASE_URL` in the Coolify Environment Variables tab resolves to `file:/app/prisma/dev.db` (the default from `.env` relative to the `/app` working directory).

## Why not Postgres?

SQLite is the right choice for this app today: single-writer access, no cross-region needs, zero ops. A migration to Postgres becomes worthwhile once (a) multiple users edit simultaneously, (b) you want managed backups, or (c) the site count grows past a few thousand. The Prisma schema will migrate cleanly when that time comes — only the `datasource db.provider` line changes.

## Why not object storage for uploads?

Same reason. `/app/public/uploads` served by Next.js is simple, fast, and the bundler already pulls referenced files into the deployed site zip. Move to S3/R2 only when (a) the uploads directory grows past a few GB or (b) you run multi-node (no shared filesystem).
