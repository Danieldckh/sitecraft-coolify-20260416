'use client';

import * as Switch from '@radix-ui/react-switch';
import { Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LockToggle({
  locked,
  onChange,
}: {
  locked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-black/10 bg-paper-raised px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {locked ? (
          <Lock className="h-4 w-4 text-amber-600" />
        ) : (
          <Unlock className="h-4 w-4 text-ink/40" />
        )}
        <span className={cn('font-medium', locked ? 'text-amber-700' : 'text-ink/70')}>
          {locked ? 'Locked' : 'Unlocked'}
        </span>
      </div>
      <Switch.Root
        checked={locked}
        onCheckedChange={onChange}
        className={cn(
          'relative h-5 w-9 rounded-full transition',
          locked ? 'bg-amber-500' : 'bg-black/15',
        )}
      >
        <Switch.Thumb
          className={cn(
            'block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform',
            'data-[state=checked]:translate-x-[18px]',
          )}
        />
      </Switch.Root>
    </div>
  );
}
