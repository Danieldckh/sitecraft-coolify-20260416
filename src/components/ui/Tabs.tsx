'use client';

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'relative inline-flex items-center gap-1 border-b',
        'border-[var(--border-subtle)]',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative inline-flex items-center h-9 px-3 text-sm font-medium',
        'text-[var(--text-secondary)]',
        'transition-colors duration-150 ease-out',
        'hover:text-[var(--text-primary)]',
        'data-[state=active]:text-[var(--text-primary)]',
        'after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px]',
        'after:bg-[var(--text-primary)] after:opacity-0 after:transition-opacity after:duration-150',
        'data-[state=active]:after:opacity-100',
        'disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 focus:outline-none', className)}
      {...props}
    />
  );
});
