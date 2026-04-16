import { notFound } from 'next/navigation';
import { prisma } from '@/server/db/client';
import { toPageDTO, toThemeDTO } from '@/server/db/mappers';
import { buildPreviewDoc } from '@/components/builder/PreviewTab/buildPreviewDoc';

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

  const [page, theme] = await Promise.all([
    prisma.page.findFirst({ where: { siteId, slug } }),
    prisma.theme.findUnique({ where: { siteId } }),
  ]);

  if (!page || !theme) notFound();

  const pageDto = toPageDTO(page);
  const themeDto = toThemeDTO(theme);

  if (!pageDto.pageHtml?.trim()) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#333',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
            This page hasn&rsquo;t been generated yet
          </h1>
          <p style={{ marginTop: '0.5rem', color: '#666' }}>
            Go back to the builder and generate {pageDto.name} from the Build
            tab.
          </p>
        </div>
      </main>
    );
  }

  const html = buildPreviewDoc({ page: pageDto, theme: themeDto });
  return (
    <iframe
      title={`${pageDto.name} preview`}
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
