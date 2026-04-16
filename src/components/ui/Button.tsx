'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const buttonStyles = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
    'font-medium tracking-tight',
    'rounded-lg border',
    'transition-[background-color,border-color,color,box-shadow,transform]',
    'duration-150 ease-out',
    'disabled:opacity-50 disabled:pointer-events-none',
    'active:scale-[0.99]',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-[var(--btn-bg)] text-[var(--btn-fg)] border-[var(--btn-border)]',
          'hover:bg-[var(--btn-bg-hover)] hover:border-[var(--btn-bg-hover)]',
          'shadow-xs',
        ].join(' '),
        secondary: [
          'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-default)]',
          'hover:bg-[var(--state-hover)]',
          'shadow-xs',
        ].join(' '),
        outline: [
          'bg-transparent text-[var(--text-primary)] border-[var(--border-default)]',
          'hover:bg-[var(--state-hover)]',
        ].join(' '),
        ghost: [
          'bg-transparent border-transparent text-[var(--text-primary)]',
          'hover:bg-[var(--state-hover)]',
        ].join(' '),
        destructive: [
          'bg-[var(--color-danger-600)] text-white border-[var(--color-danger-600)]',
          'hover:bg-[var(--color-danger-700)] hover:border-[var(--color-danger-700)]',
          'shadow-xs',
        ].join(' '),
        link: [
          'bg-transparent border-transparent text-[var(--color-brand-600)] underline-offset-4',
          'hover:underline px-0',
        ].join(' '),
      },
      size: {
        sm:   'h-7 px-2.5 text-xs',
        md:   'h-9 px-3.5 text-sm',
        lg:   'h-11 px-5 text-md',
        icon: 'h-9 w-9 p-0',
      },
      fullWidth: {
        true:  'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, loading, disabled, leftIcon, rightIcon, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export { buttonStyles };
