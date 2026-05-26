import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import { cn } from '@/src/lib/utils';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import {
  fetchDepartments,
  fetchFirms,
  fetchProjects,
  fetchSuppliers,
  fetchStores,
  fetchTransporters,
  fetchUsers,
  type Department,
  type Firm,
  type Project,
  type Store,
  type Supplier,
  type Transporter,
  type User,
} from '@/src/lib/masters';
import type { QueueFilters } from '@/src/lib/queues';

export const inputClass =
  'w-full h-10 bg-surface-container-low border border-black rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-black';

export const labelClass = 'text-[11px] font-bold text-on-surface-variant uppercase tracking-widest';

const compactControlClass =
  'w-full h-10 bg-transparent border-none rounded-none pl-0 pr-8 py-0 text-sm font-medium text-on-surface-variant outline-none focus:ring-0';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-3xl',
  fullScreen = false,
  titleCentered = false,
  headerExtra,
  headerRight,
  closeButtonLabel = 'Close',
  titleClassName,
  contentClassName,
  footerClassName,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
  fullScreen?: boolean;
  titleCentered?: boolean;
  headerExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  closeButtonLabel?: string;
  titleClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
}) {
  if (!open) return null;
  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center', fullScreen ? 'p-0' : 'p-4')}>
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div
        className={cn(
          'relative w-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col',
          fullScreen ? 'h-full max-w-none rounded-none' : cn('rounded-xl', maxWidthClass)
        )}
      >
        <div className="shrink-0 border-b border-outline-variant px-5 py-4">
          <div className={cn(titleCentered ? 'grid grid-cols-3 items-center' : 'flex items-center justify-between')}>
            {titleCentered ? <div /> : null}
	            <div className={cn('text-2xl font-bold text-on-surface leading-tight', titleCentered ? 'text-center' : '', titleClassName)}>{title}</div>
            <div className={cn(titleCentered ? 'flex justify-end' : '', 'inline-flex items-center gap-2 whitespace-nowrap')}>
              {headerRight ? <span className="inline-flex items-center">{headerRight}</span> : null}
              <button type="button" className="btn btn-sm min-w-[96px] h-9 px-4 whitespace-nowrap" onClick={onClose}>
                {closeButtonLabel}
              </button>
            </div>
          </div>
          {headerExtra ? <div className="mt-3">{headerExtra}</div> : null}
        </div>
        <div className={cn('p-5 space-y-4 overflow-auto flex-1', fullScreen ? '' : 'max-h-[75vh]', contentClassName)}>
          {children}
        </div>
        {footer ? (
          <div className={cn('shrink-0 px-5 py-4 border-t border-outline-variant flex items-center justify-end gap-2', footerClassName)}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function isAbortError(e: unknown) {
  const anyErr = e as any;
  const name = String(anyErr?.name ?? '');
  const message = String(anyErr?.message ?? anyErr ?? '');
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (name.toLowerCase() === 'aborterror') return true;
  if (message.toLowerCase().includes('aborterror')) return true;
  if (message.toLowerCase().includes('signal is aborted')) return true;
  return false;
}

export function useQueueMasters(opts?: { includeSuppliers?: boolean; includeUsers?: boolean; includeTransporters?: boolean; includeStores?: boolean }) {
  const includeSuppliers = Boolean(opts?.includeSuppliers);
  const includeUsers = Boolean(opts?.includeUsers);
  const includeTransporters = Boolean(opts?.includeTransporters);
  const includeStores = Boolean(opts?.includeStores);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    const promises: Array<Promise<any>> = [fetchFirms(ac.signal), fetchDepartments(ac.signal), fetchProjects(ac.signal)];
    if (includeSuppliers) promises.push(fetchSuppliers(ac.signal));
    if (includeUsers) promises.push(fetchUsers(ac.signal));
    if (includeTransporters) promises.push(fetchTransporters(ac.signal));
    if (includeStores) promises.push(fetchStores(ac.signal));
    Promise.all(promises)
      .then((rows) => {
        const firmRows = rows[0];
        const deptRows = rows[1];
        const projectRows = rows[2];
        setFirms(Array.isArray(firmRows) ? firmRows : []);
        setDepartments(Array.isArray(deptRows) ? deptRows : []);
        setProjects(Array.isArray(projectRows) ? projectRows : []);

        let idx = 3;
        if (includeSuppliers) {
          const supplierRows = rows[idx++];
          setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
        } else setSuppliers([]);

        if (includeUsers) {
          const userRows = rows[idx++];
          setUsers(Array.isArray(userRows) ? userRows : []);
        } else setUsers([]);

        if (includeTransporters) {
          const transporterRows = rows[idx++];
          setTransporters(Array.isArray(transporterRows) ? transporterRows : []);
        } else setTransporters([]);

        if (includeStores) {
          const storeRows = rows[idx++];
          setStores(Array.isArray(storeRows) ? storeRows : []);
        } else setStores([]);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (isAbortError(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [includeSuppliers, includeUsers, includeTransporters, includeStores]);

  return { loading, error, firms, departments, projects, suppliers, users, transporters, stores };
}

export function QueueFiltersBar({
  filters,
  onChange,
  masters,
  showSupplier = true,
}: {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  masters: { firms: Firm[]; departments: Department[]; projects: Project[]; suppliers?: Supplier[] };
  showSupplier?: boolean;
}) {
	  const firmOptions = useMemo(
	    () => [
	      { value: '', label: 'All Firms' },
	      ...masters.firms.map((f) => ({ value: f.id, label: String(f.sortName ?? '').trim() || f.name })),
	    ],
	    [masters.firms]
	  );
  const deptOptions = useMemo(
    () => [{ value: '', label: 'All Depts' }, ...masters.departments.map((d) => ({ value: d.name, label: d.name }))],
    [masters.departments]
  );
  const projectOptions = useMemo(
    () => [{ value: '', label: 'All Projects' }, ...masters.projects.map((p) => ({ value: p.id, label: p.name }))],
    [masters.projects]
  );
  const supplierOptions = useMemo(() => {
    const rows = masters.suppliers ?? [];
    return [{ value: '', label: 'All Suppliers' }, ...rows.map((s) => ({ value: s.id, label: s.name }))];
  }, [masters.suppliers]);

  return (
    <div className="flex flex-wrap items-end gap-3 bg-surface-container-lowest p-4 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)] border border-outline-variant/5">
      <div className="flex-1 min-w-[220px]">
        <div className={labelClass}>Search</div>
        <input
          className={cn(inputClass, 'mt-1')}
          value={filters.q ?? ''}
          placeholder="Search by id / supplier / project..."
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
      </div>

      <div className="min-w-[170px]">
        <div className={labelClass}>Firm</div>
        <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
          <SearchableSelect
            options={firmOptions}
            value={filters.firmId ?? ''}
            onChange={(v) => onChange({ ...filters, firmId: v })}
            placeholder="All Firms"
            controlClassName={compactControlClass}
          />
        </div>
      </div>

      <div className="min-w-[170px]">
        <div className={labelClass}>Department</div>
        <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
          <SearchableSelect
            options={deptOptions}
            value={filters.department ?? ''}
            onChange={(v) => onChange({ ...filters, department: v })}
            placeholder="All Depts"
            controlClassName={compactControlClass}
          />
        </div>
      </div>

      <div className="min-w-[190px]">
        <div className={labelClass}>Project</div>
        <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
          <SearchableSelect
            options={projectOptions}
            value={filters.projectId ?? ''}
            onChange={(v) => onChange({ ...filters, projectId: v })}
            placeholder="All Projects"
            controlClassName={compactControlClass}
          />
        </div>
      </div>

      {showSupplier ? (
        <div className="min-w-[200px]">
          <div className={labelClass}>Supplier</div>
          <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
            <SearchableSelect
              options={supplierOptions}
              value={filters.supplierId ?? ''}
              onChange={(v) => onChange({ ...filters, supplierId: v })}
              placeholder="All Suppliers"
              controlClassName={compactControlClass}
            />
          </div>
        </div>
      ) : null}

      <div className="min-w-[230px]">
        <div className={labelClass}>Date Range</div>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="date"
            className={cn(inputClass, 'py-1.5')}
            value={filters.from ?? ''}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
          />
          <span className="text-outline-variant text-sm">—</span>
          <input
            type="date"
            className={cn(inputClass, 'py-1.5')}
            value={filters.to ?? ''}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-sm"
        onClick={() => onChange({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' })}
      >
        Clear
      </button>
    </div>
  );
}

export function QueueCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 shadow-sm">
      <div className="px-5 py-4 border-b border-outline-variant/10">
        <div className="text-sm font-bold text-on-surface">{title}</div>
        {subtitle ? <div className="text-xs text-on-surface-variant mt-0.5">{subtitle}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function ExportCsvButton({
  filename,
  rows,
  disabled,
  id,
  className,
}: {
  filename: string;
  rows: any[];
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const safeDisabled = Boolean(disabled);
  return (
    <button
      id={id}
      type="button"
      className={cn('btn btn-sm', className)}
      disabled={safeDisabled}
      onClick={() => {
        const list = Array.isArray(rows) ? rows : [];
        const first = list[0] ?? {};
        const header = Object.keys(first);
        const csv = toCsv(header.length ? header : ['id'], list);
        downloadTextFile(filename, csv, 'text/csv; charset=utf-8');
      }}
      title="Export"
    >
      Export Excel
    </button>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-6 shadow-sm text-sm text-on-surface-variant">
      <div className="flex items-center gap-2 text-on-surface">
        <Spinner />
        <span>{label}</span>
      </div>
    </div>
  );
}
