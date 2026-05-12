import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import { fetchGrnsByPoId, recordQc } from '@/src/lib/purchaseRequests';
import { fetchQueueQc, type QcQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

type QcLine = {
  itemId: string;
  item: string;
  specificationsJson?: string;
  receivedQty: number;
  acceptedQty: string;
  rejectedQty: string;
  remarks: string;
};

export default function QcQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true, includeStores: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<QcQueueRow[]>([]);
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
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueQc(filters, ac.signal)
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
  const [active, setActive] = useState<QcQueueRow | null>(null);
  const [inspectedUserId, setInspectedUserId] = useState('');
  const [updatedUserId, setUpdatedUserId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [lines, setLines] = useState<QcLine[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const userOptions = useMemo(
    () => [{ value: '', label: 'Select user' }, ...masters.users.map((u) => ({ value: u.id, label: u.name }))],
    [masters.users]
  );

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setInspectedUserId('');
    setUpdatedUserId('');
    setStoreId('');
    setLines([]);
    setModalLoading(false);
    setSaving(false);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen) return;
    if (!updatedUserId && inspectedUserId) setUpdatedUserId(inspectedUserId);
  }, [inspectedUserId, modalOpen, updatedUserId]);

  useEffect(() => {
    if (!modalOpen) return;
    if (storeId) return;
    const first = masters.stores?.[0]?.id;
    if (first) setStoreId(first);
  }, [masters.stores, modalOpen, storeId]);

  useEffect(() => {
    if (!modalOpen) return;
    if (inspectedUserId) return;
    const preferred = (masters.users ?? []).find((u) => String(u.name ?? '').trim().toLowerCase() === 'accounts team');
    const first = preferred?.id ?? masters.users?.[0]?.id ?? '';
    if (first) setInspectedUserId(first);
  }, [inspectedUserId, masters.users, modalOpen]);

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setModalError(null);
    setModalLoading(true);
    fetchGrnsByPoId(active.poId, ac.signal)
      .then((grns) => {
        const g = (grns ?? []).find((x) => x.grn.id === active.grnId);
        if (!g) throw new Error('GRN not found');
	        setLines(
	          (g.items ?? []).map((it) => ({
	            itemId: it.itemId,
	            item: it.item,
	            specificationsJson: it.specificationsJson,
	            receivedQty: Number(it.quantityReceived ?? 0),
	            acceptedQty: String(it.quantityReceived ?? 0),
	            rejectedQty: '0',
	            remarks: '',
	          }))
	        );
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />
      <div className="flex justify-end">
        <ExportCsvButton filename={`queue-qc-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>

      {loading ? (
        <LoadingCard label="Loading GRNs pending QC..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Check Quality" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[190px]" />
                <col className="w-[170px]" />
                <col className="w-[200px]" />
                <col className="w-[120px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">GRN</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Received</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Items</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr key={r.grnId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.grnNumber ?? r.grnId}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPrNumber((r as any).prNumber ?? r.prId)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.receivedDate ? formatDateDDMMYYYYOnly(r.receivedDate) : '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.pendingItems}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
                            View PR
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => {
                              setActive(r);
                              setModalOpen(true);
                            }}
                          >
                            Record QC
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={8}>
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
        title={`Record QC for GRN ${active?.grnNumber ?? active?.grnId ?? ''}`}
        onClose={() => (saving ? null : closeModal())}
        maxWidthClass="max-w-7xl"
        fullScreen
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || modalLoading || !active || !inspectedUserId || !updatedUserId || !storeId || !lines.length}
              onClick={() => {
                if (!active) return;
                const inspectedBy = masters.users.find((u) => u.id === inspectedUserId)?.name ?? '';
                const updatedBy = masters.users.find((u) => u.id === updatedUserId)?.name ?? '';
                const location = masters.stores.find((s) => s.id === storeId)?.name ?? '';
                if (!inspectedBy) return setModalError('Inspected By is required');
                if (!updatedBy) return setModalError('Updated By is required');
                if (!location) return setModalError('Location is required');
                const items = lines.map((l) => {
                  const a = String(l.acceptedQty ?? '').trim() ? Number(l.acceptedQty) : 0;
                  const r = String(l.rejectedQty ?? '').trim() ? Number(l.rejectedQty) : 0;
                  return { itemId: l.itemId, item: l.item, quantityAccepted: a, quantityRejected: r, remarks: l.remarks ?? '', receivedQty: l.receivedQty };
                });
                for (const it of items) {
                  if (!Number.isFinite(it.quantityAccepted) || it.quantityAccepted < 0) {
                    setModalError('Invalid accepted qty');
                    return;
                  }
                  if (!Number.isFinite(it.quantityRejected) || it.quantityRejected < 0) {
                    setModalError('Invalid rejected qty');
                    return;
                  }
                  if (it.quantityAccepted > it.receivedQty + 1e-9) {
                    setModalError('Accepted qty cannot exceed GRN qty');
                    return;
                  }
                  if (it.quantityRejected > it.receivedQty + 1e-9) {
                    setModalError('Rejected qty cannot exceed GRN qty');
                    return;
                  }
                  if (it.quantityRejected > 0 && !String(it.remarks ?? '').trim()) {
                    setModalError('Remarks is required when Rejected Qty > 0');
                    return;
                  }
                  if (it.quantityAccepted + it.quantityRejected > it.receivedQty + 1e-9) {
                    setModalError('Accepted + rejected cannot exceed received qty');
                    return;
                  }
                }
                setSaving(true);
                setModalError(null);
                recordQc(active.grnId, {
                  inspectedBy,
                  location,
                  updatedBy,
                  items: items.map((it) => ({
                    itemId: it.itemId,
                    item: it.item,
                    quantityAccepted: it.quantityAccepted,
                    quantityRejected: it.quantityRejected,
                    remarks: it.remarks,
                  })),
                })
                  .then(() => fetchQueueQc(filters).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Update QC'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">GRN Number</div>
            <input className={cn(inputClass, 'mt-1')} value={active?.grnNumber ?? active?.grnId ?? ''} readOnly />
          </div>
          <div>
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Inspected By</div>
            <select className={cn(inputClass, 'mt-1')} value={inspectedUserId} onChange={(e) => setInspectedUserId(e.target.value)}>
              {userOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Location</div>
            <select className={cn(inputClass, 'mt-1')} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Select store</option>
              {(masters.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Updated By</div>
            <select className={cn(inputClass, 'mt-1')} value={updatedUserId} onChange={(e) => setUpdatedUserId(e.target.value)}>
              {userOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {modalLoading ? (
          <div className="text-sm text-on-surface-variant">Loading GRN items...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[420px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead>
                <tr className="bg-primary text-on-primary">
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">GRN Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Accepted</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Rejected</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {lines.length ? (
	                  lines.map((l, idx) => (
	                    <tr key={l.itemId}>
	                      <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant">{formatItemInline(l.item, l.specificationsJson, specNameById)}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{l.receivedQty}</td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
                          value={l.acceptedQty}
                          onChange={(e) =>
                            setLines((prev) => {
                              const next = prev.slice();
                              next[idx] = { ...next[idx]!, acceptedQty: e.target.value };
                              return next;
                            })
                          }
                          inputMode="decimal"
                        />
                      </td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <input
                          className={cn(inputClass, 'py-1.5')}
                          value={l.rejectedQty}
                          onChange={(e) =>
                            setLines((prev) => {
                              const next = prev.slice();
                              next[idx] = { ...next[idx]!, rejectedQty: e.target.value };
                              return next;
                            })
                          }
                          inputMode="decimal"
                        />
                      </td>
	                      <td className="px-3 py-2 border border-outline-variant">
	                        <input
	                          className={cn(inputClass, 'py-1.5')}
	                          value={l.remarks}
	                          onChange={(e) =>
	                            setLines((prev) => {
	                              const next = prev.slice();
	                              next[idx] = { ...next[idx]!, remarks: e.target.value };
	                              return next;
	                            })
	                          }
	                          placeholder={String(l.rejectedQty ?? '').trim() && Number(l.rejectedQty) > 0 ? '(required)' : '(optional)'}
	                        />
	                      </td>
	                    </tr>
	                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={5}>
                      No items.
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
