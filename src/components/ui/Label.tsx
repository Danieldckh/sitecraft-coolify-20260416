'use client';

import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, required, children, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]',
        'tracking-[var(--ls-wide)] uppercase',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden className="text-[var(--color-danger-500)] normal-case">
          *
        </span>
      ) : null}
    </label>
  );
});
