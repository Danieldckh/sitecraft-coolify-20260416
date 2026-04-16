'use client';

import { useCallback, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FileDropProps {
  accept?: string;
  maxSizeMb?: number;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export function FileDrop({
  accept,
  maxSizeMb = 20,
  multiple = false,
  onFiles,
  className,
  label = 'Drop files here or click to upload',
  hint,
  disabled = false,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      setError(null);
      if (!fileList || fileList.length === 0) return;
      const incoming = Array.from(fileList);
      const maxBytes = maxSizeMb * 1024 * 1024;
      const tooBig = incoming.find((f) => f.size > maxBytes);
      if (tooBig) {
        setError(`"${tooBig.name}" exceeds ${maxSizeMb}MB limit.`);
        return;
      }
      const list = multiple ? incoming : incoming.slice(0, 1);
      onFiles(list);
    },
    [maxSizeMb, multiple, onFiles],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragActive(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'group relative flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed',
          'px-6 py-8 text-center cursor-pointer select-none',
          'transition-[border-color,background-color,color] duration-150 ease-out',
          'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
          'hover:border-[var(--border-strong)] hover:bg-[var(--state-hover)] hover:text-[var(--text-primary)]',
          dragActive && 'border-[var(--ring-focus)] bg-[var(--color-brand-50)] text-[var(--text-primary)]',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <Upload className="h-5 w-5 opacity-70" aria-hidden />
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        {hint ? (
          <div className="text-xs text-[var(--text-muted)]">{hint}</div>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">
            Max {maxSizeMb}MB{accept ? ` — ${accept}` : ''}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error ? (
        <p className="text-xs text-[var(--color-danger-600)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
