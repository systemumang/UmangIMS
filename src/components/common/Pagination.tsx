import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export default function Pagination({
  totalItems,
  page,
  pageSize = 20,
  onPageChange,
  className,
  labelClassName,
}: {
  totalItems: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
  labelClassName?: string;
}) {
  const total = Number.isFinite(totalItems) ? Math.max(0, Math.floor(totalItems)) : 0;
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 20;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page || 1)), totalPages);

  const rangeText = useMemo(() => {
    if (!total) return 'Showing 0 entries';
    const start = (current - 1) * size + 1;
    const end = Math.min(total, current * size);
    return `Showing ${start} to ${end} of ${total} entries`;
  }, [current, size, total]);

  const canPrev = current > 1;
  const canNext = current < totalPages;

  function go(p: number) {
    const next = Math.min(Math.max(1, p), totalPages);
    onPageChange(next);
  }

  const pageButtons = useMemo(() => {
    // Compact window: first, last, +/-2 around current.
    const out: Array<number | '...'> = [];
    const windowStart = Math.max(2, current - 2);
    const windowEnd = Math.min(totalPages - 1, current + 2);

    out.push(1);
    if (windowStart > 2) out.push('...');
    for (let p = windowStart; p <= windowEnd; p += 1) out.push(p);
    if (windowEnd < totalPages - 1) out.push('...');
    if (totalPages > 1) out.push(totalPages);
    return out;
  }, [current, totalPages]);

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className={cn('text-xs text-on-surface-variant', labelClassName)}>{rangeText}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="p-1.5 rounded hover:bg-surface-container transition-colors disabled:opacity-30"
          disabled={!canPrev}
          onClick={() => go(current - 1)}
          aria-label="Previous page"
          title="Previous"
        >
          <ChevronLeft size={16} />
        </button>

        {pageButtons.map((p, idx) =>
          p === '...' ? (
            <span key={`dots-${idx}`} className="px-2 text-outline-variant text-xs">
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className={cn(
                'px-3 py-1 text-xs rounded transition-colors',
                p === current ? 'font-bold bg-primary text-on-primary shadow-sm' : 'font-medium text-on-surface-variant hover:bg-surface-container'
              )}
              aria-current={p === current ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          className="p-1.5 rounded hover:bg-surface-container transition-colors disabled:opacity-30"
          disabled={!canNext}
          onClick={() => go(current + 1)}
          aria-label="Next page"
          title="Next"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

