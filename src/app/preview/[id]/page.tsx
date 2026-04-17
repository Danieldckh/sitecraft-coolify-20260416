import { prisma } from '@/server/db/client';

export const dynamic = 'force-dynamic';

/**
 * /preview/[id] — serves the home page's raw pageHtml for the given site.
 *
 * Used by the editor's iframe. The stored HTML (Designer output) is injected
 * into a full-bleed container and its embedded <style> tags are honored by the
 * browser, preserving the data-el-id hooks used for click-to-edit.
 *
 * Note: the root layout wraps this with <html><body>, so we inject the raw
 * Designer output into a <div> here rather than a full standalone document.
 */
export default async function SitePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Prefer slug="home" (per spec); fall back to the first page by orderIdx so
  // partial builds still render.
  const page =
    (await prisma.page.findFirst({
      where: { siteId: id, slug: 'home' },
    })) ??
    (await prisma.page.findFirst({
      where: { siteId: id },
      orderBy: { orderIdx: 'asc' },
    }));

  const rawHtml = page?.pageHtml ?? '';

  if (!rawHtml.trim()) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-50 text-sm text-neutral-500">
        Waiting for sections…
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
