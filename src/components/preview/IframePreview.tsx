'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageDTO, SectionDTO } from '@/types/models';
import { buildPreview } from './buildHtml';

export interface IframePreviewProps {
  page: PageDTO & { sections: SectionDTO[] };
  sitemap: PageDTO[];
  className?: string;
}

export function IframePreview({ page, sitemap, className }: IframePreviewProps) {
  const [doc, setDoc] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const signature = useMemo(() => {
    return JSON.stringify({
      p: page.id,
      sections: page.sections.map((s) => [s.id, s.orderIdx, s.html.length, s.css.length, s.js.length, s.lastGeneratedAt]),
      sitemap: sitemap.map((p) => [p.id, p.slug, p.name, p.orderIdx, p.navVisible]),
    });
  }, [page, sitemap]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const built = buildPreview({ page, sitemap });
      setDoc(built.fullDoc);
    }, 200);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <iframe
      title={`preview:${page.name}`}
      sandbox="allow-scripts"
      srcDoc={doc}
      className={className ?? 'w-full h-full bg-white'}
    />
  );
}
