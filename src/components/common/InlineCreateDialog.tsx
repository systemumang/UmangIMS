import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function InlineCreateDialog({
  open,
  title,
  value,
  setValue,
  error,
  busy,
  placeholder,
  submitLabel = 'Create',
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  setValue: (v: string) => void;
  error?: string | null;
  busy?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
          <div className="text-sm font-bold text-on-surface">{title}</div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error ? <div className="text-xs text-error">{error}</div> : null}
          <input
            ref={inputRef}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
            value={value}
            placeholder={placeholder ?? 'Enter name'}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter') onSubmit();
            }}
          />

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
              disabled={Boolean(busy) || !value.trim()}
              onClick={onSubmit}
            >
              {busy ? 'Creating...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

