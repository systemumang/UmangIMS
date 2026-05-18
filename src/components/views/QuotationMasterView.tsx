import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { cn } from '@/src/lib/utils';
import Pagination from '@/src/components/common/Pagination';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { fetchRfqItems, fetchRfqs, type RfqItemRow, type RfqListFilters, type RfqRow } from '@/src/lib/quotations';
import { ExportCsvButton, inputClass, labelClass, LoadingCard, QueueCard, useQueueMasters } from './queues/shared';

type StatusFilter = '' | 'created' | 'closed';

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function formatSpecificationText(raw: string) {
  const txt = String(raw ?? '').trim();
  if (!txt) return '-';
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const lines = Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => {
          const key = String(k ?? '').trim();
          const value = String(v ?? '').trim();
          if (!value) return '';
          if (isUuidLike(key)) return value;
          return `${key}: ${value}`;
        })
        .filter(Boolean);
      return lines.length ? lines.join(' - ') : '-';
    }
  } catch {}
  return txt;
}

export default function QuotationMasterView() {
  const masters = useQueueMasters({ includeSuppliers: true });
  const [filters, setFilters] = useState<RfqListFilters>({ q: '', firmId: '', projectId: '', status: '', from: '', to: '' });
  const [rows, setRows] = useState<RfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 20;
  const [page, setPage] = useState(1);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchRfqs(filters, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [filters]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, rows.length]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  const firmOptions = useMemo(
    () => [{ value: '', label: 'All Firms' }, ...masters.firms.map((f) => ({ value: f.id, label: f.name }))],
    [masters.firms]
  );
  const projectOptions = useMemo(
    () => [{ value: '', label: 'All Projects' }, ...masters.projects.map((p) => ({ value: p.id, label: p.name }))],
    [masters.projects]
  );

  const [expandedRfqId, setExpandedRfqId] = useState<string>('');
  const [expandedLoadingRfqId, setExpandedLoadingRfqId] = useState<string>('');
  const [expandedItemsByRfqId, setExpandedItemsByRfqId] = useState<Record<string, RfqItemRow[]>>({});
  const [expandedErrorByRfqId, setExpandedErrorByRfqId] = useState<Record<string, string>>({});

  const toggleExpand = (rfqId: string) => {
    const id = String(rfqId ?? '').trim();
    if (!id) return;
    const next = expandedRfqId === id ? '' : id;
    setExpandedRfqId(next);
    if (!next) return;

    if (expandedItemsByRfqId[id]) return;
    setExpandedLoadingRfqId(id);
    setExpandedErrorByRfqId((m) => ({ ...m, [id]: '' }));
    const ac = new AbortController();
    fetchRfqItems(id, ac.signal)
      .then((items) => {
        setExpandedItemsByRfqId((m) => ({ ...m, [id]: items }));
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setExpandedErrorByRfqId((m) => ({ ...m, [id]: e instanceof Error ? e.message : String(e) }));
      })
      .finally(() => setExpandedLoadingRfqId(''));
  };

  const pendingCount = useMemo(() => rows.reduce((sum, r) => sum + Number(r.pendingRateCount ?? 0), 0), [rows]);

  return (
    <QueueCard title="Quotation Master" subtitle={`${rows.length} RFQs • ${pendingCount} pending supplier rates`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-on-surface-variant">
          Showing {pagedRows.length} / {rows.length}
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton filename={`quotation-master-${Date.now()}.csv`} rows={rows} disabled={!rows.length} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <div className={labelClass}>Search</div>
          <input
            className={cn(inputClass, 'py-1.5')}
            value={filters.q ?? ''}
            onChange={(e) => setFilters((m) => ({ ...m, q: e.target.value }))}
            placeholder="RFQ no / Firm / Project"
          />
        </div>

        <div className="min-w-[200px]">
          <div className={labelClass}>Firm</div>
          <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
            <SearchableSelect
              options={firmOptions}
              value={filters.firmId ?? ''}
              onChange={(v) => setFilters((m) => ({ ...m, firmId: v }))}
              placeholder="All Firms"
              controlClassName="w-full h-7 bg-transparent border-none rounded-none pl-0 pr-8 py-0 text-xs font-medium text-on-surface-variant outline-none focus:ring-0"
            />
          </div>
        </div>

        <div className="min-w-[220px]">
          <div className={labelClass}>Project</div>
          <div className="mt-1 bg-surface-container-low px-3 py-1.5 rounded-lg border border-black">
            <SearchableSelect
              options={projectOptions}
              value={filters.projectId ?? ''}
              onChange={(v) => setFilters((m) => ({ ...m, projectId: v }))}
              placeholder="All Projects"
              controlClassName="w-full h-7 bg-transparent border-none rounded-none pl-0 pr-8 py-0 text-xs font-medium text-on-surface-variant outline-none focus:ring-0"
            />
          </div>
        </div>

        <div className="min-w-[170px]">
          <div className={labelClass}>Status</div>
          <select
            className={cn(inputClass, 'py-1.5')}
            value={(filters.status as StatusFilter) ?? ''}
            onChange={(e) => setFilters((m) => ({ ...m, status: e.target.value }))}
          >
            <option value="">All</option>
            <option value="created">Created</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="min-w-[230px]">
          <div className={labelClass}>Date Range</div>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="date"
              className={cn(inputClass, 'py-1.5')}
              value={filters.from ?? ''}
              onChange={(e) => setFilters((m) => ({ ...m, from: e.target.value }))}
            />
            <span className="text-outline-variant text-sm">—</span>
            <input
              type="date"
              className={cn(inputClass, 'py-1.5')}
              value={filters.to ?? ''}
              onChange={(e) => setFilters((m) => ({ ...m, to: e.target.value }))}
            />
          </div>
        </div>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setFilters({ q: '', firmId: '', projectId: '', status: '', from: '', to: '' })}
        >
          Clear
        </button>
      </div>

      {loading ? (
        <div className="mt-4">
          <LoadingCard label="Loading RFQs..." />
        </div>
      ) : error ? (
        <div className="mt-4 text-sm text-error">{error}</div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="overflow-auto">
            <table className="min-w-[1100px] w-full text-sm border-collapse border border-outline-variant">
              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                <tr className="bg-surface-container-high">
                  <th className="text-left px-3 py-2 border border-outline-variant w-[40px]"></th>
                  <th className="text-left px-3 py-2 border border-outline-variant">RFQ</th>
                  <th className="text-left px-3 py-2 border border-outline-variant">Date</th>
                  <th className="text-left px-3 py-2 border border-outline-variant">Firm</th>
                  <th className="text-left px-3 py-2 border border-outline-variant">Project</th>
                  <th className="text-left px-3 py-2 border border-outline-variant">Status</th>
                  <th className="text-right px-3 py-2 border border-outline-variant">Items</th>
                  <th className="text-right px-3 py-2 border border-outline-variant">Pending Rate</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const id = String(r.id ?? '').trim();
                  const isExpanded = expandedRfqId === id;
                  const isExpandedLoading = expandedLoadingRfqId === id;
                  const expandedError = expandedErrorByRfqId[id];
                  const items = expandedItemsByRfqId[id] ?? [];
                  return (
                    <React.Fragment key={id}>
                      <tr
                        className={cn('cursor-pointer hover:bg-surface-container-high/40 transition-colors', isExpanded ? 'bg-primary/5' : '')}
                        onClick={() => toggleExpand(id)}
                      >
                        <td className="px-3 py-2 border border-outline-variant">
                          <ChevronDown size={16} className={cn('transition-transform', isExpanded ? 'rotate-180' : 'rotate-0')} />
                        </td>
                        <td className="px-3 py-2 text-primary font-semibold border border-outline-variant">{r.rfqNumber || '-'}</td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant">
                          {r.rfqDate ? formatDateDDMMYYYYOnly(r.rfqDate) : '-'}
                        </td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant">{r.firmName || '-'}</td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant">{r.projectName || '-'}</td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant">{r.status || '-'}</td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant text-right tabular-nums">
                          {Number(r.itemCount ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-on-surface-variant border border-outline-variant text-right tabular-nums">
                          {Number(r.pendingRateCount ?? 0)}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-3 border border-outline-variant bg-surface-container-lowest">
                            {isExpandedLoading ? <div className="text-sm text-on-surface-variant">Loading RFQ items...</div> : null}
                            {!isExpandedLoading && expandedError ? <div className="text-sm text-error">Failed to load items: {expandedError}</div> : null}
                            {!isExpandedLoading && !expandedError ? (
                              <div className="overflow-x-auto">
                                <table className="min-w-[980px] w-full text-sm border-collapse border border-outline-variant">
                                  <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                                    <tr className="bg-surface-container-high">
                                      <th className="text-left px-3 py-2 border border-outline-variant">Item</th>
                                      <th className="text-left px-3 py-2 border border-outline-variant">Specification</th>
                                      <th className="text-right px-3 py-2 border border-outline-variant">Qty</th>
                                      <th className="text-left px-3 py-2 border border-outline-variant">Supplier</th>
                                      <th className="text-right px-3 py-2 border border-outline-variant">Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(items.length ? items : [{ rfqItemId: '', itemId: '', itemName: '-', specification: '', quantity: 0 } as any]).map((it, idx) => (
                                      <tr key={`${String(it.rfqItemId ?? idx)}-${idx}`}>
                                        <td className="px-3 py-2 border border-outline-variant">{it.itemName || '-'}</td>
	                                        <td className="px-3 py-2 border border-outline-variant text-on-surface-variant whitespace-normal break-words">
	                                          {formatSpecificationText(String(it.specification ?? ''))}
	                                        </td>
                                        <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.quantity ?? 0)}</td>
                                        <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{it.supplierName || '-'}</td>
                                        <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">
                                          {it.supplierRate != null && Number.isFinite(Number(it.supplierRate)) ? Number(it.supplierRate) : '-'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={rows.length}
            onPageChange={setPage}
            className="justify-end"
          />
        </div>
      )}
    </QueueCard>
  );
}
