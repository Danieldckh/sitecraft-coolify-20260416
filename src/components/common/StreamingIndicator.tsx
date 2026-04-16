'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface StreamingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function StreamingIndicator({
  label = 'Thinking',
  className,
  ...props
}: StreamingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]',
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]"
      style={{
        animation: 'sc-dot-bounce 1.1s ease-in-out infinite',
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

// Animation keyframes injected globally below via styled element.
// (Kept inline to avoid touching globals.css for a tiny effect.)
if (typeof document !== 'undefined' && !document.getElementById('sc-dot-bounce-style')) {
  const style = document.createElement('style');
  style.id = 'sc-dot-bounce-style';
  style.textContent = `
    @keyframes sc-dot-bounce {
      0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
      40%           { opacity: 1;    transform: translateY(-2px); }
    }
  `;
  document.head.appendChild(style);
}
