import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db/client';

export const dynamic = 'force-dynamic';

export default async function PreviewSiteIndex({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const first = await prisma.page.findFirst({
    where: { siteId },
    orderBy: { orderIdx: 'asc' },
  });
  if (!first) notFound();
  redirect(`/preview/${siteId}/${first.slug}`);
}
