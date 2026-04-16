'use client';

import { use, useEffect } from 'react';
import { Canvas } from '@/components/editor/Canvas';
import { Inspector } from '@/components/editor/Inspector';
import { SiteInfoPanel } from '@/components/editor/SiteInfoPanel';
import { TopBar } from '@/components/editor/TopBar';
import { useEditorStore } from '@/stores/editor';

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const setSiteId = useEditorStore((s) => s.setSiteId);
  const select = useEditorStore((s) => s.select);

  useEffect(() => {
    setSiteId(id);
    select({ kind: 'site', id });
  }, [id, setSiteId, select]);

  return (
    <div className="flex h-screen flex-col bg-paper">
      <TopBar siteId={id} />
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_380px]">
        <SiteInfoPanel siteId={id} />
        <div className="relative min-h-0 border-r border-black/10 bg-paper">
          <Canvas siteId={id} />
        </div>
        <div className="min-h-0 overflow-hidden bg-paper-raised">
          <Inspector siteId={id} />
        </div>
      </div>
    </div>
  );
}
