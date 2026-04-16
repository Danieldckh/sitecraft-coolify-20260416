import { notFound } from 'next/navigation';
import { prisma } from '@/server/db/client';
import { toPageDTO, toSiteDTO, toThemeDTO } from '@/server/db/mappers';
import { buildFullSiteDoc } from '@/components/builder/PreviewTab/buildFullSiteDoc';

export const dynamic = 'force-dynamic';

interface Params {
  siteId: string;
  slug: string;
}

export default async function StandalonePreviewPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { siteId, slug } = await params;

  const [site, pages, theme] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.page.findMany({ where: { siteId }, orderBy: { orderIdx: 'asc' } }),
    prisma.theme.findUnique({ where: { siteId } }),
  ]);

  if (!site || !theme || pages.length === 0) notFound();
  if (!pages.some((p) => p.slug === slug)) notFound();

  const siteDto = toSiteDTO(site);
  const themeDto = toThemeDTO(theme);
  const pageDtos = pages.map(toPageDTO);

  const html = buildFullSiteDoc({
    site: siteDto,
    theme: themeDto,
    pages: pageDtos,
    currentSlug: slug,
  });

  return (
    <iframe
      title={`${siteDto.name} preview`}
      srcDoc={html}
      sandbox="allow-scripts"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        border: 0,
        background: '#fff',
      }}
    />
  );
}
