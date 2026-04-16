import { prisma } from '@/server/db/client';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'page';
}

export async function uniquePageSlug(siteId: string, desired: string, ignorePageId?: string): Promise<string> {
  const base = slugify(desired);
  let candidate = base;
  let i = 2;
  while (true) {
    const existing = await prisma.page.findUnique({ where: { siteId_slug: { siteId, slug: candidate } } });
    if (!existing || existing.id === ignorePageId) return candidate;
    candidate = `${base}-${i++}`;
  }
}
