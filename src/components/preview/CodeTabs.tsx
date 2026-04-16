'use client';

import { useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import dynamic from 'next/dynamic';
import type { PageDTO, SectionDTO } from '@/types/models';
import { buildPreview } from './buildHtml';
import { IframePreview } from './IframePreview';

const Monaco = dynamic(() => import('@monaco-editor/react'), { ssr: false });

export interface CodeTabsProps {
  page: PageDTO & { sections: SectionDTO[] };
  sitemap: PageDTO[];
  className?: string;
}

const TAB_CLS =
  'px-3 py-1.5 text-xs font-medium text-ink-soft/60 data-[state=active]:text-ink data-[state=active]:bg-paper-raised data-[state=active]:shadow-sm rounded-md transition';

export function CodeTabs({ page, sitemap, className }: CodeTabsProps) {
  const built = useMemo(() => buildPreview({ page, sitemap }), [page, sitemap]);

  return (
    <Tabs.Root defaultValue="preview" className={className ?? 'flex flex-col h-full'}>
      <Tabs.List className="flex items-center gap-1 p-1 border-b border-black/5 bg-paper">
        <Tabs.Trigger value="preview" className={TAB_CLS}>Preview</Tabs.Trigger>
        <Tabs.Trigger value="html" className={TAB_CLS}>HTML</Tabs.Trigger>
        <Tabs.Trigger value="css" className={TAB_CLS}>CSS</Tabs.Trigger>
        <Tabs.Trigger value="js" className={TAB_CLS}>JS</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="preview" className="flex-1 min-h-0">
        <IframePreview page={page} sitemap={sitemap} className="w-full h-full bg-white" />
      </Tabs.Content>
      <Tabs.Content value="html" className="flex-1 min-h-0">
        <Monaco height="100%" language="html" value={built.fullDoc} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
      </Tabs.Content>
      <Tabs.Content value="css" className="flex-1 min-h-0">
        <Monaco height="100%" language="css" value={built.css} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
      </Tabs.Content>
      <Tabs.Content value="js" className="flex-1 min-h-0">
        <Monaco height="100%" language="javascript" value={built.js} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
