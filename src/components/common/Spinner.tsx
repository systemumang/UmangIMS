import React from 'react';
import { cn } from '@/src/lib/utils';

export default function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-label="Loading"
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-primary', className)}
    />
  );
}
