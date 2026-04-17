import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /preview/[id]/[slug] — serves a specific page's raw pageHtml for the given
 * site. Used by the editor's iframe.
 *
 * The stored HTML is a full document (Designer output wrapped in the site's
 * document template). We inject it into a full-bleed container via
 * dangerouslySetInnerHTML so its embedded <style> tags take effect and the
 * data-el-id hooks used for click-to-edit remain in the DOM.
 *
 * Notes on nav links:
 *   - Designer/footer/header sections emit relative `./{slug}` hrefs.
 *   - Inside the iframe, `/preview/[id]/about` resolving `./store` yields
 *     `/preview/[id]/store` — which is exactly this route. No rewrites needed
 *     for the preview pass; the export route handles the `.html` rewrite.
 *
 * The root layout wraps this with <html><body>, so we inject the full
 * document's body markup (plus its <style>/<link>) into a <div>. Browsers
 * render <style>/<link> inside the body just fine, and the `<head>` content
 * from the preview layout doesn't conflict.
 */
export default async function SitePreviewPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;

  const page = await prisma.page.findUnique({
    where: { siteId_slug: { siteId: id, slug } },
    select: { pageHtml: true },
  });

  const rawHtml = page?.pageHtml ?? '';

  if (!rawHtml.trim()) {
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
        Page not ready yet…
      </div>
    );
  }

  return (
    <div
      id="sc-preview-root"
      style={{ minHeight: '100vh', width: '100%' }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: rawHtml }}
    />
  );
}
