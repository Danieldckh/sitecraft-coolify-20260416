// GET /api/sites — return every site the user has built, most recent first,
// each with a lightweight summary of its latest deployment (if any).
//
// Shape:
//   {
//     sites: [
//       {
//         id, name, sitePrompt, createdAt, updatedAt,
//         deployment: { url, status, updatedAt } | null
//       },
//       ...
//     ]
//   }

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { enforceRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeploymentSummary {
  url: string | null;
  status: string;
  updatedAt: string;
}

interface SiteSummary {
  id: string;
  name: string;
  sitePrompt: string;
  createdAt: string;
  updatedAt: string;
  deployment: DeploymentSummary | null;
  build: { pagesPlanned: number; pagesReady: number; inProgress: boolean };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'read');
  if (limited) return limited;

  try {
    const sites = await prisma.site.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        sitePrompt: true,
        planJson: true,
        createdAt: true,
        updatedAt: true,
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            url: true,
            status: true,
            updatedAt: true,
          },
        },
        pages: {
          select: { slug: true, pageHtml: true },
        },
      },
    });

    const payload: { sites: SiteSummary[] } = {
      sites: sites.map((s) => {
        let pagesPlanned = 0;
        if (s.planJson) {
          try {
            const plan = JSON.parse(s.planJson) as { pages?: unknown[] };
            if (Array.isArray(plan.pages)) pagesPlanned = plan.pages.length;
          } catch {
            /* planJson malformed — treat as no plan */
          }
        }
        const pagesReady = s.pages.filter((p) => p.pageHtml && p.pageHtml.length > 0).length;
        const inProgress = pagesPlanned > 0 && pagesReady < pagesPlanned;

        return {
          id: s.id,
          name: s.name,
          sitePrompt: s.sitePrompt,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          deployment: s.deployments[0]
            ? {
                url: s.deployments[0].url,
                status: s.deployments[0].status,
                updatedAt: s.deployments[0].updatedAt.toISOString(),
              }
            : null,
          build: { pagesPlanned, pagesReady, inProgress },
        };
      }),
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/sites] list failed', err);
    return NextResponse.json({ error: 'Failed to load sites' }, { status: 500 });
  }
}
