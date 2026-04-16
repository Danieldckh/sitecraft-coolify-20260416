'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft } from 'lucide-react';

import { BuilderShell } from '@/components/builder/BuilderShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton, SkeletonText } from '@/components/common/SkeletonLoader';
import { useSite } from '@/hooks/use-site';

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: site, isLoading, error } = useSite(id);

  if (isLoading) return <EditorSkeleton />;

  if (error || !site) return <NotFound />;

  return <BuilderShell siteId={id} />;
}

function EditorSkeleton() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28" />
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <SkeletonText lines={4} />
            <Card className="space-y-4 p-6">
              <SkeletonText lines={5} />
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] p-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold tracking-[var(--ls-tight)] text-[var(--text-primary)]">
          Site not found
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          The site you&rsquo;re looking for has been deleted, or the link is wrong.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/sites">
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}>
              Back to sites
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
