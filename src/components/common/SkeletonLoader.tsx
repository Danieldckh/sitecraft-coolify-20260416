'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('sc-shimmer rounded-md', className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function SkeletonText({ lines = 3, className, ...props }: SkeletonTextProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${85 - i * 8}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-5 shadow-xs',
        className,
      )}
      {...props}
    >
      <Skeleton className="mb-4 h-5 w-1/3" />
      <SkeletonText lines={3} />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-14" />
      </div>
    </div>
  );
}
