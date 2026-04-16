'use client';

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
        brand:   'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]',
        success: 'bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[var(--color-success-500)]/30',
        warning: 'bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-500)]/30',
        danger:  'bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border-[var(--color-danger-500)]/30',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeStyles> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, ...props },
  ref,
) {
  return <span ref={ref} className={cn(badgeStyles({ variant }), className)} {...props} />;
});
