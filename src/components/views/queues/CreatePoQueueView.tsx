import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { createPo, fetchLastSupplierByItemIds, fetchPos, fetchRequest } from '@/src/lib/purchaseRequests';
import { fetchQueueCreatePo, type CreatePoQueueRow, type QueueFilters } from '@/src/lib/queues';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { cn } from '@/src/lib/utils';
import { clampPercentString, sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

type Line = {
  itemId: string;
  item: string;
  specification: string;
  prItemId: string;
  approvedQty: number;
  orderedQty: number;
  remainingQty: number;
  lastSupplierName: string;
  lastRate: number;
  supplierId: string;
  paymentTerms: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxPercent: string;
};

function formatItemWithSpecification(item: string, specification: string) {
  const base = String(item ?? '').trim();
  const specs = String(specification ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!specs.length) return base || '-';
  return [base, ...specs].filter(Boolean).join(' - ');
}

export default function CreatePoQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<CreatePoQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, departments: masters.departments, projects: masters.projects, suppliers: masters.suppliers }),
    [masters.departments, masters.firms, masters.projects, masters.suppliers]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueCreatePo(filters, ac.signal)
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

  const [modalOpen, setModalOpen] = useState(false);
  const [activePrId, setActivePrId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const supplierOptions = useMemo(
    () => masters.suppliers.map((s) => ({ value: s.id, label: s.name })),
    [masters.suppliers]
  );

  function closeModal() {
    setModalOpen(false);
    setActivePrId(null);
    setLines([]);
    setModalError(null);
    setSaving(false);
    setModalLoading(false);
  }

  useEffect(() => {
    if (!modalOpen || !activePrId) return;
    const ac = new AbortController();
    setModalError(null);
    setModalLoading(true);
    Promise.all([fetchRequest(activePrId, ac.signal), fetchPos(activePrId, ac.signal)])
      .then(async ([pr, pos]) => {
        const orderedByItemId = new Map<string, number>();
        for (const p of pos ?? []) {
          for (const it of p.items ?? []) {
            orderedByItemId.set(it.itemId, (orderedByItemId.get(it.itemId) ?? 0) + Number(it.quantity ?? 0));
          }
        }

        const itemIds = pr.items.map((it) => it.itemId).filter(Boolean);
        const lastSupplier = itemIds.length ? await fetchLastSupplierByItemIds(itemIds, ac.signal) : {};

        const nextLines: Line[] = pr.items.map((it) => {
          const approvedQty = Number(it.quantity ?? 0);
          const orderedQty = Number(orderedByItemId.get(it.itemId) ?? 0);
          const remainingQty = Math.max(0, approvedQty - orderedQty);
          const suggested = lastSupplier[it.itemId];
          const suggestedSupplierId = suggested?.supplierId ? String(suggested.supplierId) : '';
          const suggestedTerms = suggestedSupplierId
            ? String(masters.suppliers.find((s) => s.id === suggestedSupplierId)?.paymentTerms ?? '').trim()
            : '';
	          return {
            itemId: it.itemId,
            item: it.item,
            specification: it.specification ?? '',
            prItemId: it.id,
            approvedQty,
            orderedQty,
            remainingQty,
            lastSupplierName: suggested?.supplierName ? String(suggested.supplierName) : '',
            lastRate: Number(suggested?.rate ?? 0),
            supplierId: suggestedSupplierId,
            paymentTerms: suggestedTerms,
	            quantity: remainingQty > 0 ? String(remainingQty) : '',
	            rate: suggested && Number.isFinite(suggested.rate) ? String(suggested.rate) : '',
	            discountPercent: '',
	            taxPercent: '',
	          };
	        });

        const filtered = nextLines.filter((l) => l.remainingQty > 0);
        setLines(filtered);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [activePrId, modalOpen]);

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />
      <div className="flex justify-end">
        <ExportCsvButton filename={`queue-create-po-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>

      {loading ? (
        <LoadingCard label="Loading PRs pending PO..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Create PO" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
	            <table className="w-full min-w-[1060px] table-fixed text-left border-collapse border border-outline-variant">
	              <colgroup>
	                <col className="w-[130px]" />
	                <col className="w-[180px]" />
	                <col className="w-[140px]" />
	                <col className="w-[200px]" />
	                <col className="w-[140px]" />
	                <col className="w-[160px]" />
	                <col className="w-[240px]" />
	              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Dept</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Project</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Req Date</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Remaining Qty</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
	                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr key={r.prId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.prNumber ?? r.prId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.department}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.projectName ?? '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requisitionDate ? formatDateDDMMYYYYOnly(r.requisitionDate) : '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.remainingQty}</td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <div className="flex items-center gap-2 flex-wrap">
                          <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
                            View PR
                          </button>
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => {
                            setActivePrId(r.prId);
                            setModalOpen(true);
                          }}
                        >
                          Create PO
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
	                  <tr>
	                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={7}>
	                      No records.
	                    </td>
	                  </tr>
	                )}
              </tbody>
            </table>
	          </div>
	          <div className="pt-3">
	            <Pagination totalItems={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
	          </div>
	        </QueueCard>
      )}

      <Modal
        open={modalOpen}
        title={`Make PO`}
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        titleCentered
        titleClassName="text-primary text-base font-bold"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
	            <button
	              type="button"
	              className="btn-primary btn-sm"
	              disabled={saving || modalLoading || !activePrId || !lines.some((l) => Number(l.quantity) > 0)}
	              onClick={() => {
	                if (!activePrId) return;
	                const picked = lines
	                  .map((l) => ({
	                    itemId: l.itemId,
	                    supplierId: String(l.supplierId ?? '').trim(),
	                    paymentTerms: String(l.paymentTerms ?? '').trim(),
	                    quantity: String(l.quantity ?? '').trim() ? Number(l.quantity) : 0,
	                    rate: String(l.rate ?? '').trim() ? Number(l.rate) : 0,
	                    discountPercent: String(l.discountPercent ?? '').trim() ? Number(l.discountPercent) : 0,
	                    taxPercent: String(l.taxPercent ?? '').trim() ? Number(l.taxPercent) : 0,
	                    remainingQty: l.remainingQty,
	                  }))
	                  .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);

	                const missingSupplier = picked.find((x) => !x.supplierId);
	                if (missingSupplier) {
	                  setModalError('Select supplier for all items where Qty PO is entered.');
	                  return;
	                }
	                const missingTerms = picked.find((x) => !x.paymentTerms);
	                if (missingTerms) {
	                  setModalError('Payment terms are required for all items where Qty PO is entered.');
	                  return;
	                }

	                for (const it of picked) {
	                  if (it.quantity > it.remainingQty + 1e-9) {
	                    setModalError('PO quantity cannot exceed remaining PR quantity');
	                    return;
	                  }
	                  if (!Number.isFinite(it.rate) || it.rate < 0) {
	                    setModalError('Invalid rate');
	                    return;
	                  }
	                  if (!Number.isFinite(it.discountPercent) || it.discountPercent < 0 || it.discountPercent > 100) {
	                    setModalError('Invalid discount percent');
	                    return;
	                  }
	                  if (!Number.isFinite(it.taxPercent) || it.taxPercent < 0 || it.taxPercent > 100) {
	                    setModalError('Invalid tax percent');
	                    return;
	                  }
	                  if (!masters.suppliers.some((s) => s.id === it.supplierId)) {
	                    setModalError('Select a valid supplier for all PO lines.');
	                    return;
	                  }
	                }

	                const groups = new Map<
	                  string,
	                  {
	                    supplierName: string;
	                    paymentTerms: string;
	                    items: Array<{ itemId: string; quantity: number; rate: number; discountPercent: number; taxPercent: number }>;
	                  }
	                >();
	                for (const it of picked) {
	                  const supplierName = String(masters.suppliers.find((s) => s.id === it.supplierId)?.name ?? '').trim();
	                  if (!supplierName) {
	                    setModalError('Supplier name is missing for a selected supplier.');
	                    return;
	                  }
	                  const key = `${it.supplierId}||${it.paymentTerms}`;
	                  const existing = groups.get(key);
	                  const itemLine = { itemId: it.itemId, quantity: it.quantity, rate: it.rate, discountPercent: it.discountPercent, taxPercent: it.taxPercent };
	                  if (existing) existing.items.push(itemLine);
	                  else groups.set(key, { supplierName, paymentTerms: it.paymentTerms, items: [itemLine] });
	                }

	                setSaving(true);
	                setModalError(null);
	                Promise.resolve()
	                  .then(async () => {
	                    for (const [, g] of groups.entries()) {
	                      await createPo(activePrId, { supplier: g.supplierName, paymentTerms: g.paymentTerms, items: g.items });
	                    }
	                  })
	                  .then(() => fetchQueueCreatePo(filters).then(setRows))
	                  .then(() => closeModal())
	                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
	                  .finally(() => setSaving(false));
	              }}
	            >
              {saving ? 'Creating...' : 'Make PO'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        {modalLoading ? (
          <div className="text-sm text-on-surface-variant">Loading PR items...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[320px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[90px]" />
                <col className="w-[90px]" />
                <col className="w-[90px]" />
                <col className="w-[90px]" />
                <col className="w-[140px]" />
                <col className="w-[90px]" />
                <col className="w-[160px]" />
                <col className="w-[90px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Qty (Already Created)</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Qty PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Rate</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Disc %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GST %</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Last Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Last Rate</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Terms</th>
                </tr>
              </thead>
              <tbody>
                {lines.length ? (
                  lines.map((l, idx) => (
                    <tr key={l.itemId}>
                      <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
                        {formatItemWithSpecification(l.item, l.specification)}
                      </td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.approvedQty}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.orderedQty}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.remainingQty}</td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.quantity}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, quantity: sanitizeDecimalInput(e.target.value) };
	                              return next;
	                            })
	                          }
	                          type="text"
	                          inputMode="decimal"
	                        />
	                      </td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.rate}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, rate: sanitizeDecimalInput(e.target.value) };
	                              return next;
	                            })
	                          }
	                          type="text"
	                          inputMode="decimal"
	                        />
	                      </td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.discountPercent}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, discountPercent: sanitizePercentInput(e.target.value) };
	                              return next;
	                            })
	                          }
	                          onBlur={() =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, discountPercent: clampPercentString(next[idx]!.discountPercent) };
	                              return next;
	                            })
	                          }
	                          type="text"
	                          inputMode="decimal"
	                        />
	                      </td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.taxPercent}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, taxPercent: sanitizePercentInput(e.target.value) };
	                              return next;
	                            })
	                          }
	                          onBlur={() =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, taxPercent: clampPercentString(next[idx]!.taxPercent) };
	                              return next;
	                            })
	                          }
	                          type="text"
	                          inputMode="decimal"
	                        />
	                      </td>
                      <td className="px-3 py-2 text-xs text-on-surface-variant border border-outline-variant">{l.lastSupplierName || '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(l.lastRate ?? 0) || '-'}</td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <SearchableSelect
	                          value={l.supplierId}
	                          options={supplierOptions}
	                          allowClear
	                          disabled={masters.loading}
	                          placeholder="Select supplier..."
	                          onChange={(nextId) => {
	                            const safeId = String(nextId ?? '').trim();
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              if (!safeId) {
	                                next[idx] = { ...next[idx]!, supplierId: '', paymentTerms: '' };
	                                return next;
	                              }
	                              const suggested = String(masters.suppliers.find((s) => s.id === safeId)?.paymentTerms ?? '').trim();
	                              const currentTerms = String(next[idx]?.paymentTerms ?? '').trim();
	                              next[idx] = { ...next[idx]!, supplierId: safeId, paymentTerms: currentTerms || suggested };
	                              return next;
	                            });
	                          }}
	                        />
	                      </td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.paymentTerms}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, paymentTerms: e.target.value };
	                              return next;
	                            })
	                          }
	                        />
	                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={7}>
                      No remaining items to order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
