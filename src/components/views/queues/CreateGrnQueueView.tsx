import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { createGrnForPo, fetchPendingGrnItems, fetchPos, type Po, type PoItem } from '@/src/lib/purchaseRequests';
import { fetchQueueCreateGrn, type CreateGrnQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { cn } from '@/src/lib/utils';
import { inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type PendingItem = { itemId: string; item: string; pendingQty: number; rate: number };

export default function CreateGrnQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<CreateGrnQueueRow[]>([]);
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
    fetchQueueCreateGrn(filters, ac.signal)
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
  const [active, setActive] = useState<CreateGrnQueueRow | null>(null);
  const [activePoDetails, setActivePoDetails] = useState<{ po: Po; items: PoItem[] } | null>(null);
  const [receivedDate, setReceivedDate] = useState(todayIsoDate());
  const [materialReceivedByUserId, setMaterialReceivedByUserId] = useState('');
  const [goodsCollectedByUserId, setGoodsCollectedByUserId] = useState('');
  const [updatedByUserId, setUpdatedByUserId] = useState('');
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [qtyByItemId, setQtyByItemId] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setActivePoDetails(null);
    setPendingItems([]);
    setQtyByItemId({});
    setReceivedDate(todayIsoDate());
    setMaterialReceivedByUserId('');
    setGoodsCollectedByUserId('');
    setUpdatedByUserId('');
    setSaving(false);
    setModalError(null);
    setModalLoading(false);
    setDetailLoading(false);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setModalError(null);
    setModalLoading(true);
    fetchPendingGrnItems(active.poId, ac.signal)
      .then((items) => {
        setPendingItems(items);
        const draft: Record<string, string> = {};
        for (const it of items) draft[it.itemId] = String(it.pendingQty ?? 0);
        setQtyByItemId(draft);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setDetailLoading(true);
    setModalError(null);
    setActivePoDetails(null);
    fetchPos(active.prId, ac.signal)
      .then((pos) => {
        const found = (pos ?? []).find((p) => String(p?.po?.id ?? '').trim() === String(active.poId ?? '').trim());
        if (!found) throw new Error('PO details not found');
        setActivePoDetails({ po: found.po, items: Array.isArray(found.items) ? found.items : [] });
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setDetailLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    if (masters.loading) return;
    if (!masters.users.length) return;
    const firstUserId = masters.users[0]!.id;
    if (!updatedByUserId) setUpdatedByUserId(firstUserId);
    if (!materialReceivedByUserId) setMaterialReceivedByUserId(firstUserId);
    if (!goodsCollectedByUserId) setGoodsCollectedByUserId(firstUserId);
  }, [goodsCollectedByUserId, masters.loading, masters.users, materialReceivedByUserId, modalOpen, updatedByUserId]);

  function displayUserName(rawValue: string | null | undefined) {
    const v = String(rawValue ?? '').trim();
    if (!v) return '-';
    if (v.startsWith('USER-')) return masters.users.find((u) => u.id === v)?.name ?? v;
    return v;
  }

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

      {loading ? (
        <LoadingCard label="Loading POs pending GRN..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Create GRN" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[140px]" />
                <col className="w-[190px]" />
                <col className="w-[170px]" />
                <col className="w-[200px]" />
                <col className="w-[120px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Dept</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr key={r.poId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPrNumber(r.prId)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.department}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.pendingQty}</td>
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
                            Create GRN
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
        title="Pending PO for GRN (1)"
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        contentClassName="p-3"
        titleCentered
        titleClassName="text-blue-600 text-base font-bold"
        headerExtra={
          <div className="flex flex-wrap items-end justify-end gap-3">
            <div className="min-w-[170px]">
              <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Received Date</div>
              <input className={cn(inputClass, 'mt-1')} type="date" value={receivedDate} disabled={saving} onChange={(e) => setReceivedDate(e.target.value)} />
            </div>
            <div className="min-w-[220px]">
              <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Material Received By</div>
              <select
                className={cn(inputClass, 'mt-1')}
                value={materialReceivedByUserId}
                disabled={saving || masters.loading}
                onChange={(e) => setMaterialReceivedByUserId(e.target.value)}
              >
                <option value="">{masters.loading ? 'Loading users...' : 'Select user'}</option>
                {masters.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px]">
              <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Goods Collected By</div>
              <select
                className={cn(inputClass, 'mt-1')}
                value={goodsCollectedByUserId}
                disabled={saving || masters.loading}
                onChange={(e) => setGoodsCollectedByUserId(e.target.value)}
              >
                <option value="">{masters.loading ? 'Loading users...' : 'Select user'}</option>
                {masters.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px]">
              <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Updated By</div>
              <select
                className={cn(inputClass, 'mt-1')}
                value={updatedByUserId}
                disabled={saving || masters.loading}
                onChange={(e) => setUpdatedByUserId(e.target.value)}
              >
                <option value="">{masters.loading ? 'Loading users...' : 'Select user'}</option>
                {masters.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={
                saving ||
                modalLoading ||
                detailLoading ||
                !active ||
                !activePoDetails ||
                !receivedDate ||
                !materialReceivedByUserId ||
                !goodsCollectedByUserId ||
                !updatedByUserId ||
                !pendingItems.length
              }
              onClick={() => {
                if (!active) return;
                if (!activePoDetails) return;
                if (!receivedDate) {
                  setModalError('Received date is required');
                  return;
                }
                if (!materialReceivedByUserId) {
                  setModalError('Material Received By is required');
                  return;
                }
                if (!goodsCollectedByUserId) {
                  setModalError('Goods Collected By is required');
                  return;
                }
                if (!updatedByUserId) {
                  setModalError('Updated By is required');
                  return;
                }
                const items = pendingItems
                  .map((it) => {
                    const raw = qtyByItemId[it.itemId];
                    const q = raw != null && String(raw).trim() ? Number(raw) : 0;
                    return { itemId: it.itemId, item: it.item, quantityReceived: q, pendingQty: it.pendingQty };
                  })
                  .filter((x) => Number.isFinite(x.quantityReceived) && x.quantityReceived > 0);
                for (const it of items) {
                  if (it.quantityReceived > it.pendingQty + 1e-9) {
                    setModalError('Received qty cannot exceed pending qty');
                    return;
                  }
                }
                setSaving(true);
                setModalError(null);
                const updatedByName = masters.users.find((u) => u.id === updatedByUserId)?.name ?? updatedByUserId;
                createGrnForPo(active.poId, {
                  receivedDate,
                  materialReceivedBy: materialReceivedByUserId,
                  goodsCollectedBy: goodsCollectedByUserId,
                  updatedBy: updatedByName,
                  items: items.map((x) => ({ itemId: x.itemId, item: x.item, quantityReceived: x.quantityReceived })),
                })
                  .then(() => fetchQueueCreateGrn(filters).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Creating...' : 'Create GRN'}
            </button>
          </>
        }
	      >
	        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

	        {detailLoading || modalLoading ? (
	          <div className="text-sm text-on-surface-variant">Loading PO details...</div>
	        ) : activePoDetails ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] table-fixed text-left border-collapse border border-black text-sm [&_th]:border-black [&_td]:border-black">
              <colgroup>
                <col className="w-[130px]" />
                <col className="w-[170px]" />
                <col className="w-[90px]" />
                <col className="w-[520px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[90px]" />
                <col className="w-[90px]" />
                <col className="w-[170px]" />
                <col className="w-[200px]" />
                <col className="w-[200px]" />
              </colgroup>
              <thead>
                <tr className="bg-blue-700">
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PO No</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Supplier</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Terms</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Items</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PO Qty</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PO Rate</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Disc %</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">GST %</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Pending GRN Qty</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Checked By</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Sent By</th>
                </tr>
              </thead>
              <tbody>
                {(activePoDetails.items.length ? activePoDetails.items : ([{ poId: activePoDetails.po.id, itemId: '', item: '-', quantity: 0, rate: 0 }] as any)).map(
	                  (it: PoItem, idx: number) => {
	                    const rowSpan = activePoDetails.items.length || 1;
	                    const pendingRow = pendingItems.find((p) => String(p.itemId ?? '').trim() === String(it.itemId ?? '').trim());
	                    const pendingQty = pendingRow ? Number(pendingRow.pendingQty ?? 0) : 0;
	                    const checkedByName = displayUserName(activePoDetails.po.checkPoUserId);
	                    const sentByName = displayUserName(activePoDetails.po.sentBy);
	                    return (
	                      <tr key={`${String(it.itemId ?? idx)}-${idx}`}>
                        {idx === 0 ? (
                          <>
                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm font-semibold text-on-surface border border-black align-top break-words">
                              {formatPoNumber(activePoDetails.po.id)}
                            </td>
                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-black align-top break-words">
                              {activePoDetails.po.supplier || '-'}
                            </td>
                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top break-words">
                              {activePoDetails.po.paymentTerms || '-'}
                            </td>
                          </>
                        ) : null}
                        <td className="px-2 py-2 text-sm text-on-surface border border-black align-top whitespace-normal break-words">
                          {formatItemInline(it.item, it.specificationsJson)}
                        </td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{Number(it.quantity ?? 0)}</td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{Number(it.rate ?? 0)}</td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.discountPercent ?? '-'}</td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.taxPercent ?? '-'}</td>
                        <td className="px-2 py-2 border border-black align-top">
                          <input
                            className={cn(inputClass, 'py-1.5')}
                            value={qtyByItemId[it.itemId] ?? String(pendingQty)}
                            onChange={(e) => setQtyByItemId((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
                            inputMode="decimal"
                          />
                        </td>
                        {idx === 0 ? (
                          <>
                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-black align-top break-words">
                              {checkedByName}
                            </td>
                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm text-on-surface border border-black align-top break-words">
                              {sentByName}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
