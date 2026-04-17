import { redirect } from 'next/navigation';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /preview/[id] — redirect to the site's first page.
 *
 * The real HTML is served by `/preview/[id]/[slug]`. This route exists so
 * that a bare `/preview/[id]` URL still lands on the home page (or whichever
 * page has the lowest orderIdx if the build is mid-flight and "home" hasn't
 * been persisted yet).
 *
 * If no pages exist yet (we're inside the build window between the Site row
 * being created and the Architect's plan being persisted), render a tiny
 * "building…" placeholder instead of 404-ing.
 */
export default async function SitePreviewRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const firstPage = await prisma.page.findFirst({
    where: { siteId: id },
    orderBy: { orderIdx: 'asc' },
    select: { slug: true },
  });

  if (!firstPage) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          color: '#666',
          background: '#fafafa',
        }}
      >
        Building site…
      </div>
    );
  }

  redirect(`/preview/${id}/${firstPage.slug}`);
}
