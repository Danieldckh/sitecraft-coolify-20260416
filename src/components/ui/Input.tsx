'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const inputStyles = cva(
  [
    'block w-full rounded-lg border bg-[var(--input-bg)] text-[var(--text-primary)]',
    'placeholder:text-[var(--text-muted)]',
    'transition-[border-color,box-shadow] duration-150 ease-out',
    'outline-none',
    'disabled:opacity-60 disabled:cursor-not-allowed',
    'focus:border-[var(--ring-focus)]',
    'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring-focus)_22%,transparent)]',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-9 px-3 text-sm',
        lg: 'h-11 px-3.5 text-md',
      },
      error: {
        true:  'border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-danger-500)_22%,transparent)]',
        false: 'border-[var(--input-border)]',
      },
    },
    defaultVariants: { size: 'md', error: false },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputStyles> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, error, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={error || undefined}
      className={cn(inputStyles({ size, error }), className)}
      {...props}
    />
  );
});
