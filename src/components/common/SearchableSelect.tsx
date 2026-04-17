import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/src/lib/utils';

export type SearchableOption = { value: string; label: string };

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled,
  onCreate,
  createLabel,
  closeOnCreate,
  showCreateWhenEmpty,
  alwaysShowCreate,
  allowEmptyCreate,
  className,
}: {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onCreate?: (label: string) => Promise<{ value: string; label: string } | null> | ({ value: string; label: string } | null);
  createLabel?: (query: string) => string;
  closeOnCreate?: boolean;
  showCreateWhenEmpty?: boolean;
  alwaysShowCreate?: boolean;
  allowEmptyCreate?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = useMemo(() => options.find((o) => o.value === value)?.label ?? '', [options, value]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((o) => o.label.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, options]);

  const effectiveShowCreateWhenEmpty = Boolean(showCreateWhenEmpty) && Boolean(onCreate);
  const effectiveAlwaysShowCreate = Boolean(alwaysShowCreate) && Boolean(onCreate);
  const canCreate = Boolean(onCreate) && (Boolean(normalizedQuery) || effectiveShowCreateWhenEmpty);
  const exactExists = useMemo(() => {
    if (!normalizedQuery) return false;
    return options.some((o) => o.label.trim().toLowerCase() === normalizedQuery);
  }, [normalizedQuery, options]);
  const showCreate = canCreate && (effectiveAlwaysShowCreate || !exactExists);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current && rootRef.current.contains(t)) return;
      if (dropdownRef.current && dropdownRef.current.contains(t)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDropdownPos(null);
      return;
    }

    const update = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownPos({
        top: Math.round(rect.bottom + 4),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const inputValue = open ? query : selectedLabel;
  const createText = useMemo(() => {
    const q = query.trim();
    if (creating) return 'Creating...';
    if (!q && !allowEmptyCreate) return createLabel ? createLabel('') : '+ Add New (type name)';
    if (createLabel) return createLabel(q);
    if (!q) return '+ Add New';
    return `+ Add "${q}"`;
  }, [allowEmptyCreate, createLabel, creating, query]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        className={cn(
          'w-full bg-surface-container-lowest border border-blue-600/35 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15',
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        )}
        value={inputValue}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          if (disabled) return;
          setOpen(true);
          setQuery(e.target.value);
        }}
	        onKeyDown={(e) => {
	          if (!open) return;
	          if (e.key === 'Escape') {
	            setOpen(false);
	            setQuery('');
	            inputRef.current?.blur();
	            return;
	          }
	          if (e.key === 'Enter') {
	            e.preventDefault();
	            const first = filtered[0];
	            if (first) {
	              onChange(first.value);
	              setOpen(false);
	              setQuery('');
	              return;
	            }
	            if (showCreate && onCreate) {
	              const label = query.trim();
	              if (!label && !effectiveShowCreateWhenEmpty) return;
	              if (!label && !allowEmptyCreate) {
	                inputRef.current?.focus();
	                return;
	              }
	              if (closeOnCreate) {
	                setOpen(false);
	                setQuery('');
	              }
	              setCreating(true);
	              Promise.resolve(onCreate(label))
	                .then((created) => {
	                  if (created) onChange(created.value);
	                  if (created || closeOnCreate) {
	                    setOpen(false);
	                    setQuery('');
	                  }
	                })
	                .finally(() => setCreating(false));
	            }
	          }
	        }}
	      />

	      {open && dropdownPos
	        ? createPortal(
	            <div
	              ref={dropdownRef}
	              className="fixed z-[9999] rounded-lg border border-blue-600/45 bg-surface-container-lowest shadow-2xl max-h-72 flex flex-col overflow-hidden"
	              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
	            >
	              <div className="overflow-auto">
	                {filtered.slice(0, 50).map((o) => (
	                  <button
	                    key={o.value}
	                    type="button"
	                    className={cn(
	                      'w-full text-left px-3 py-2 text-sm hover:bg-surface-container-high transition-colors',
	                      o.value === value ? 'bg-surface-container-highest' : ''
	                    )}
	                    onClick={() => {
	                      onChange(o.value);
	                      setOpen(false);
	                      setQuery('');
	                    }}
	                  >
	                    {o.label}
	                  </button>
	                ))}

	                {!filtered.length && !showCreate ? (
	                  <div className="px-3 py-2 text-sm text-on-surface-variant">No matches</div>
	                ) : null}
	              </div>

	              {showCreate ? (
	                <button
	                  type="button"
	                  disabled={creating}
	                  className="w-full text-left px-3 py-2 text-sm font-bold text-primary bg-surface-container-highest border-t border-blue-600/25 hover:bg-surface-container-high transition-colors disabled:opacity-60"
	                  onClick={() => {
	                    if (!onCreate) return;
	                    const label = query.trim();
	                    if (!label && !allowEmptyCreate) {
	                      inputRef.current?.focus();
	                      return;
	                    }
	                    if (closeOnCreate) {
	                      setOpen(false);
	                      setQuery('');
	                    }
	                    setCreating(true);
	                    Promise.resolve(onCreate(label))
	                      .then((created) => {
	                        if (created) onChange(created.value);
	                        if (created || closeOnCreate) {
	                          setOpen(false);
	                          setQuery('');
	                        }
	                      })
	                      .finally(() => setCreating(false));
	                  }}
	                >
	                  {createText}
	                </button>
	              ) : null}
	            </div>,
	            document.body
	          )
	        : null}
    </div>
  );
}
