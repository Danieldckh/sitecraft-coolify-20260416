'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  autoGrow?: boolean;
  maxRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, error, autoGrow = true, maxRows = 14, onInput, rows = 3, ...props },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !autoGrow) return;
    // Reset then measure scrollHeight for fallback support.
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20');
    const maxH = lineHeight * maxRows;
    const next = Math.min(el.scrollHeight, maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [autoGrow, maxRows]);

  useEffect(() => {
    resize();
  }, [resize, props.value, props.defaultValue]);

  return (
    <textarea
      ref={innerRef}
      rows={rows}
      aria-invalid={error || undefined}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      className={cn(
        'block w-full rounded-lg border bg-[var(--input-bg)] text-[var(--text-primary)]',
        'px-3 py-2 text-sm',
        'placeholder:text-[var(--text-muted)]',
        'transition-[border-color,box-shadow] duration-150 ease-out',
        'outline-none resize-none',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        'focus:border-[var(--ring-focus)]',
        'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring-focus)_22%,transparent)]',
        error
          ? 'border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-danger-500)_22%,transparent)]'
          : 'border-[var(--input-border)]',
        '[field-sizing:content]',
        className,
      )}
      {...props}
    />
  );
});
