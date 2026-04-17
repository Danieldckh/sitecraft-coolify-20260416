import { EditorClient } from './editor-client';

export const dynamic = 'force-dynamic';

export default async function SiteEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const buildingParam = sp?.building;
  const building = Array.isArray(buildingParam)
    ? buildingParam.includes('1')
    : buildingParam === '1';

  return <EditorClient siteId={id} building={building} />;
}
