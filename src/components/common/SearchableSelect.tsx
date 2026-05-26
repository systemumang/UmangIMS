import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
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
  inputClassName,
  controlClassName,
  allowClear,
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
  inputClassName?: string;
  controlClassName?: string;
  allowClear?: boolean;
}) {
  const normalize = (v: unknown) => String(v ?? '').trim();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const normalizedValue = useMemo(() => normalize(value), [value]);
  const selectedLabel = useMemo(() => {
    if (!normalizedValue) return '';
    return options.find((o) => normalize(o.value) === normalizedValue)?.label ?? '';
  }, [normalizedValue, options]);
  const displayLabel = selectedLabel || (normalizedValue ? normalizedValue : '');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; height: number; maxHeight: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const optionsWithCurrent = useMemo(() => {
    const hasCurrent = normalizedValue && options.some((o) => normalize(o.value) === normalizedValue);
    if (hasCurrent || !normalizedValue) return options;
    return [{ value: normalizedValue, label: displayLabel || normalizedValue }, ...options];
  }, [displayLabel, normalizedValue, options]);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return optionsWithCurrent.filter((o) => String(o.label ?? '').toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, optionsWithCurrent]);

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
      const el = controlRef.current ?? rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 4;
      const viewportPad = 8;
      const maxMenuHeight = 420;

      // Account for CSS zoom (used globally in this app) by converting the
      // rect (visual px) back to layout px using an observed scale factor.
      const htmlZoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom || '1');
      // Prefer the explicit `zoom` value when it differs from 1.0.
      // (`offsetWidth` tends to track the zoomed layout size, making rect/offset ~= 1.0.)
      const offsetW = (el as HTMLElement).offsetWidth;
      const scaleFromZoom = Number.isFinite(htmlZoom) && htmlZoom > 0 && Math.abs(htmlZoom - 1) > 1e-3 ? htmlZoom : NaN;
      const scaleFromRect = offsetW ? rect.width / offsetW : NaN;
      const scale = (Number.isFinite(scaleFromZoom) ? scaleFromZoom : Number.isFinite(scaleFromRect) && scaleFromRect > 0 ? scaleFromRect : 1) || 1;

      const viewportW = window.innerWidth / scale;
      const viewportH = window.innerHeight / scale;
      const rectLeft = rect.left / scale;
      const rectTop = rect.top / scale;
      const rectBottom = rect.bottom / scale;
      const rectWidth = rect.width / scale;

      const spaceBelow = viewportH - rectBottom - gap - viewportPad;
      const spaceAbove = rectTop - gap - viewportPad;

      // Ensure the menu always has enough room to show at least 1 option row,
      // otherwise the list area collapses (especially on small available space).
      const headerH = 56; // search input container
      const footerH = showCreate ? 44 : 0; // create button
      const minListH = 44; // at least one option row
      const minMenuH = headerH + footerH + minListH;

      const openUp = spaceBelow < minMenuH && spaceAbove > spaceBelow;
      const available = Math.max(0, openUp ? spaceAbove : spaceBelow);
      const menuH = Math.min(maxMenuHeight, Math.max(minMenuH, available));

      const scrollX = window.scrollX || 0;
      const scrollY = window.scrollY || 0;

      const desiredLeft = rectLeft + scrollX;
      const minLeft = scrollX + viewportPad;
      const left = Math.max(desiredLeft, minLeft);
      const maxWidthFromLeft = Math.max(0, scrollX + viewportW - viewportPad - left);
      const width = Math.max(0, Math.min(rectWidth, maxWidthFromLeft));

      const desiredTop = openUp ? rectTop + scrollY - gap - menuH : rectBottom + gap + scrollY;
      const minTop = scrollY + viewportPad;
      const top = Math.max(minTop, desiredTop);

      setDropdownPos({
        top: Math.round(top),
        left: Math.round(left),
        width: Math.round(width),
        height: Math.round(menuH),
        maxHeight: Math.round(menuH),
      });
    };

    // Run positioning after layout, and again on the next frame to catch
    // late layout changes (fonts, scrollbars, etc.).
    update();
    if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('scroll', update, true);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const createText = useMemo(() => {
    const q = query.trim();
    if (creating) return 'Creating...';
    if (!q && !allowEmptyCreate) return createLabel ? createLabel('') : '+ Add New (type name)';
    if (createLabel) return createLabel(q);
    if (!q) return '+ Add New';
    return `+ Add "${q}"`;
  }, [allowEmptyCreate, createLabel, creating, query]);

  const defaultInputControl = 'w-full h-10 bg-surface-container-lowest border border-outline-variant rounded-lg pl-3 pr-14 py-2 text-base text-on-surface-variant placeholder:text-on-surface-variant outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15';
  const defaultButtonControl =
    'w-full min-h-10 bg-surface-container-lowest border border-outline-variant rounded-lg pl-3 pr-14 py-2 text-base text-left text-on-surface-variant outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15 whitespace-nowrap overflow-hidden text-ellipsis leading-tight';
  const inputControlClass = controlClassName ?? defaultInputControl;
  const buttonControlClass = controlClassName ?? defaultButtonControl;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={controlRef}
        type="button"
        disabled={disabled}
        className={cn(buttonControlClass, disabled ? 'opacity-60 cursor-not-allowed' : '', inputClassName)}
        title={selectedLabel || ''}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => {
            const next = !prev;
            if (next) setQuery('');
            return next;
          });
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
            setQuery('');
          }
        }}
      >
        {displayLabel ? <span className="text-on-surface-variant">{displayLabel}</span> : <span className="text-outline-variant">{placeholder}</span>}
      </button>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-outline-variant">
        {allowClear && value && !disabled ? (
          <button
            type="button"
            aria-label="Clear"
            title="Clear"
            className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-primary/10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
              setOpen(false);
              setQuery('');
            }}
          >
            <X size={14} />
          </button>
        ) : null}
        <ChevronDown size={16} className={cn('transition-transform', open ? 'rotate-180' : '')} />
      </div>

      {open && dropdownPos
        ? createPortal(
            <div
              ref={dropdownRef}
              className="absolute z-[20000] rounded-lg border border-outline-variant bg-surface-container-lowest shadow-xl flex flex-col overflow-hidden"
              style={{
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownPos.width,
                height: dropdownPos.height,
                maxHeight: dropdownPos.maxHeight,
              }}
            >
              <div className="p-2 border-b border-outline-variant bg-surface-container-lowest">
                <input
                  ref={searchRef}
                  className={cn(inputControlClass, 'h-9', inputClassName)}
                  value={query}
                  placeholder="Search..."
                  disabled={disabled}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setOpen(false);
                      setQuery('');
                      controlRef.current?.focus();
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = filtered[0];
                      if (first) {
                        onChange(first.value);
                        setOpen(false);
                        setQuery('');
                        controlRef.current?.focus();
                        return;
                      }
                      if (showCreate && onCreate) {
                        const label = query.trim();
                        if (!label && !effectiveShowCreateWhenEmpty) return;
                        if (!label && !allowEmptyCreate) {
                          searchRef.current?.focus();
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
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
	                {filtered.slice(0, 100).map((o) => (
	                  <button
	                    key={o.value}
	                    type="button"
	                    className={cn(
	                      'w-full text-left px-3 py-2 text-base text-on-surface-variant hover:bg-primary/10 transition-colors',
	                      o.value === value ? 'bg-primary/15' : ''
	                    )}
	                    onMouseDown={(e) => {
	                      // Avoid unintended parent handlers (modals/overlays) from reacting to menu clicks.
	                      e.preventDefault();
	                      e.stopPropagation();
	                    }}
	                    onClick={(e) => {
	                      e.preventDefault();
	                      e.stopPropagation();
	                      onChange(o.value);
	                      setOpen(false);
	                      setQuery('');
	                      controlRef.current?.focus();
	                    }}
	                  >
                    {o.label}
                  </button>
                ))}

                {!filtered.length ? <div className="px-3 py-2 text-sm text-on-surface-variant">No matches</div> : null}
              </div>

			              {showCreate ? (
			                <button
			                  type="button"
			                  disabled={creating}
			                  onMouseDown={(e) => {
			                    // Prevent parent click/blur handlers from interfering with create flows.
			                    // This is especially important when the caller opens a modal in `onCreate`.
			                    e.preventDefault();
			                    e.stopPropagation();
			                  }}
						                  className="w-full text-left px-3 py-2 text-base font-bold text-on-primary bg-primary border-t border-outline-variant hover:bg-primary-dim transition-colors disabled:opacity-60"
						                  onClick={(e) => {
				                    e.preventDefault();
				                    e.stopPropagation();
				                    if (!onCreate) return;
				                    const label = query.trim();
					                    if (!label && !allowEmptyCreate) {
			                      searchRef.current?.focus();
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
