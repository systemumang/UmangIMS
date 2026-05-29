import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { createGrnForPo, fetchPendingGrnItems, fetchPos, type Po, type PoItem } from '@/src/lib/purchaseRequests';
import { fetchQueueCreateGrn, type CreateGrnQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type PendingItem = { itemId: string; item: string; pendingQty: number; rate: number };

export default function CreateGrnQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  function normalizeAreaUnitName(unitName: string) {
    const u = String(unitName ?? '').trim().toLowerCase();
    if (!u) return null;
    if (u === 'sq ft' || u === 'sqft' || u === 'sq. ft' || u === 'sqft.' || u === 'sq feet') return 'sqft';
    if (u === 'sq mtr' || u === 'sq mtrs' || u === 'sqmtr' || u === 'sq. mtr' || u === 'sq meter' || u === 'sq metre' || u === 'sq m' || u === 'sqm')
      return 'sqm';
    return null;
  }

  function baseDimUnitForAreaUnit(areaUnit: 'sqft' | 'sqm' | null) {
    if (areaUnit === 'sqft') return 'ft';
    if (areaUnit === 'sqm') return 'm';
    return '';
  }

  function round2(n: number) {
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }

  function computeAreaQty(length: number, breadth: number, pcs: number) {
    const l = round2(length);
    const b = round2(breadth);
    const p = Math.trunc(pcs);
    if (!Number.isFinite(l) || l <= 0) return NaN;
    if (!Number.isFinite(b) || b <= 0) return NaN;
    if (!Number.isFinite(p) || p < 1) return NaN;
    return l * b * p;
  }

  function convertAreaQty(qty: number, fromDimUnit: string, toDimUnit: string) {
    const q = Number(qty);
    const fromU = String(fromDimUnit ?? '').trim().toLowerCase();
    const toU = String(toDimUnit ?? '').trim().toLowerCase();
    if (!Number.isFinite(q)) return NaN;
    if (!fromU || !toU || fromU === toU) return q;
    const M2_TO_FT2 = 10.7639104167;
    if (fromU === 'm' && toU === 'ft') return q * M2_TO_FT2;
    if (fromU === 'ft' && toU === 'm') return q / M2_TO_FT2;
    return NaN;
  }

  function getConvertedDim(val: string, from: 'ft' | 'm' | '') {
    const n = Number(val);
    if (!val || !Number.isFinite(n) || n <= 0 || !from) return null;
    if (from === 'ft') return `${(n / 3.28084).toFixed(2)} m`;
    if (from === 'm') return `${(n * 3.28084).toFixed(2)} ft`;
    return null;
  }

  function getConvertedArea(val: string, from: 'sqft' | 'sqm' | null) {
    const n = Number(val);
    if (!val || !Number.isFinite(n) || n <= 0 || !from) return null;
    if (from === 'sqft') return `${(n / 10.7639).toFixed(2)} sqm`;
    if (from === 'sqm') return `${(n * 10.7639).toFixed(2)} sqft`;
    return null;
  }

  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', projectId: '', supplierId: '', from: '', to: '' });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rows, setRows] = useState<CreateGrnQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, projects: masters.projects, suppliers: masters.suppliers }),
    [masters.firms, masters.projects, masters.suppliers]
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
    setSelectedRowId(null);
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
  const [dimsByItemId, setDimsByItemId] = useState<Record<string, { length: string; breadth: string; pcs: string }>>({});
  const [inputUnitByItemId, setInputUnitByItemId] = useState<Record<string, 'ft' | 'm'>>({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedPoId, setExpandedPoId] = useState('');
  const [expandedItemsByPoId, setExpandedItemsByPoId] = useState<Record<string, PendingItem[]>>({});
  const [expandedLoadingPoId, setExpandedLoadingPoId] = useState('');
  const [expandedErrorByPoId, setExpandedErrorByPoId] = useState<Record<string, string>>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setActivePoDetails(null);
    setPendingItems([]);
    setQtyByItemId({});
    setDimsByItemId({});
    setInputUnitByItemId({});
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
    const byId = masters.users.find((u) => String(u.id ?? '').trim() === v);
    if (byId?.name) return String(byId.name);
    // Hide internal ids if we don't have a name mapping.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return '-';
    return v;
  }

  async function toggleExpandRow(row: CreateGrnQueueRow) {
    const poId = String(row.poId ?? '').trim();
    if (!poId) return;
    if (expandedPoId === poId) {
      setExpandedPoId('');
      setSelectedItemId(null);
      return;
    }
    setExpandedPoId(poId);
    setSelectedItemId(null);
    if (expandedItemsByPoId[poId] || expandedLoadingPoId === poId) return;
    setExpandedLoadingPoId(poId);
    setExpandedErrorByPoId((prev) => ({ ...prev, [poId]: '' }));
    try {
      const items = await fetchPendingGrnItems(poId);
      setExpandedItemsByPoId((prev) => ({ ...prev, [poId]: Array.isArray(items) ? items : [] }));
    } catch (e) {
      setExpandedErrorByPoId((prev) => ({ ...prev, [poId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExpandedLoadingPoId((prev) => (prev === poId ? '' : prev));
    }
  }

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
	        <div className="text-sm text-on-surface-variant">Create GRN</div>
	        <ExportCsvButton id="pending-export-btn" filename={`queue-create-grn-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
	        <LoadingCard label="Loading POs pending GRN..." />
	      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Create GRN" subtitle={`${rows.length} pending`} hideHeader>
          <div className="overflow-x-auto">
	            <table className="w-full min-w-[1260px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[140px]" />
                <col className="w-[190px]" />
                <col className="w-[200px]" />
                <col className="w-[120px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Pending Qty</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => {
                    const poId = String(r.poId ?? '').trim();
                    const isExpanded = expandedPoId === poId;
                    const isExpandedLoading = expandedLoadingPoId === poId;
                    const expandedItems = expandedItemsByPoId[poId] ?? [];
                    const expandedError = expandedErrorByPoId[poId];
                    return (
                    <React.Fragment key={r.poId}>
                    <tr
                      onClick={() => {
                        toggleExpandRow(r);
                        setSelectedRowId(selectedRowId === r.poId ? null : r.poId);
                      }}
                      className={cn(
                        'cursor-pointer transition-colors',
                        isExpanded || selectedRowId === r.poId ? 'bg-primary/10' : 'hover:bg-surface-container-high/40'
                      )}
                    >
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId)}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPrNumber((r as any).prNumber ?? r.prId)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{r.pendingQty}</td>
	                      <td className="px-3 py-2 border border-outline-variant" onClick={(e) => e.stopPropagation()}>
	                        <div className="flex items-center gap-2 flex-wrap">
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
                    {isExpanded ? (
                      <tr>
	                        <td colSpan={6} className="px-3 py-3 border border-outline-variant bg-surface-container-lowest">
                          {isExpandedLoading ? <div className="text-sm text-on-surface-variant">Loading PO item details...</div> : null}
                          {!isExpandedLoading && expandedError ? <div className="text-sm text-error">{expandedError}</div> : null}
                          {!isExpandedLoading && !expandedError ? (
                            <div className="overflow-x-auto">
	                              <table className="w-full min-w-[860px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                                <thead>
	                                  <tr className="bg-surface-container-high">
	                                    <th className="px-3 py-2 border border-outline-variant">Item</th>
                                      <th className="px-3 py-2 border border-outline-variant">Priority</th>
	                                    <th className="px-3 py-2 border border-outline-variant">Pending GRN Qty</th>
	                                  </tr>
	                                </thead>
	                                <tbody>
	                                  {expandedItems.length ? (
	                                    expandedItems
                                        .filter((it) => !selectedItemId || it.itemId === selectedItemId)
                                        .map((it) => (
	                                      <tr
                                          key={it.itemId}
                                          className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedItemId === it.itemId && 'bg-primary/10')}
                                          onClick={() => setSelectedItemId(selectedItemId === it.itemId ? null : it.itemId)}
                                        >
	                                        <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item}</td>
                                        <td className="px-3 py-2 border border-outline-variant">{String((it as any).priority ?? (r as any).priority ?? '').trim() || '-'}</td>
	                                        <td className="px-3 py-2 border border-outline-variant tabular-nums">{Number(it.pendingQty ?? 0)}</td>
	                                      </tr>
	                                    ))
	                                  ) : (
	                                    <tr>
	                                      <td className="px-3 py-3 border border-outline-variant text-on-surface-variant" colSpan={3}>
	                                        No pending items.
	                                      </td>
	                                    </tr>
	                                  )}
	                                </tbody>
	                              </table>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  )})
                ) : (
                  <tr>
		                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={6}>
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
                    const poItem = (activePoDetails.items ?? []).find((x) => String(x.itemId ?? '').trim() === String(it.itemId ?? '').trim());
                    const poDimUnit =
                      String((poItem as any)?.dimUnit ?? '').trim() ||
                      baseDimUnitForAreaUnit(normalizeAreaUnitName(String((poItem as any)?.unit ?? '')));
                    const isArea = poDimUnit === 'ft' || poDimUnit === 'm';
                    const dims = dimsByItemId[it.itemId] ?? { length: '', breadth: '', pcs: '1' };
                    const inputUnit = (inputUnitByItemId[it.itemId] ?? (poDimUnit === 'm' ? 'm' : 'ft')) as 'ft' | 'm';
                    const qtyInputUnit = isArea ? computeAreaQty(Number(dims.length), Number(dims.breadth), Number(dims.pcs || 1)) : NaN;
                    const q = isArea ? convertAreaQty(qtyInputUnit, inputUnit, poDimUnit) : (() => {
                      const raw = qtyByItemId[it.itemId];
                      return raw != null && String(raw).trim() ? Number(raw) : 0;
                    })();
                    return {
                      itemId: it.itemId,
                      item: it.item,
                      quantityReceived: q,
                      pendingQty: it.pendingQty,
                      ...(isArea ? { length: Number(dims.length), breadth: Number(dims.breadth), pcs: Number(dims.pcs || 1), inputUnit } : {}),
                    };
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
                  items: items.map((x) => ({
                    itemId: x.itemId,
                    item: x.item,
                    quantityReceived: x.quantityReceived,
                    ...(('length' in x || 'breadth' in x || 'pcs' in x) ? { length: (x as any).length, breadth: (x as any).breadth, pcs: (x as any).pcs, inputUnit: (x as any).inputUnit } : {}),
                  })),
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
            <table className="w-full min-w-[1700px] table-fixed text-left border-collapse border border-black text-sm [&_th]:border-black [&_td]:border-black">
	              <colgroup>
	                <col className="w-[120px]" />
	                <col className="w-[160px]" />
	                <col className="w-[100px]" />
	                <col className="w-[320px]" />
                  <col className="w-[80px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
                  <col className="w-[80px]" />
	                <col className="w-[110px]" />
	                <col className="w-[110px]" />
	                <col className="w-[100px]" />
	                <col className="w-[90px]" />
	                <col className="w-[90px]" />
	                <col className="w-[200px]" />
                <col className="w-[160px]" />
                <col className="w-[160px]" />
              </colgroup>
              <thead>
                <tr className="bg-blue-700">
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PO No</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Supplier</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Terms</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Items</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Unit</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Length</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Breadth</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PCs</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Priority</th>
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
                      const poDimUnit =
                        String((it as any).dimUnit ?? '').trim() || baseDimUnitForAreaUnit(normalizeAreaUnitName(String((it as any).unit ?? '')));
                      const isAreaUnit = poDimUnit === 'ft' || poDimUnit === 'm';
                      const dims = dimsByItemId[it.itemId] ?? { length: '', breadth: '', pcs: '1' };
                      const inputUnit = inputUnitByItemId[it.itemId] ?? (poDimUnit === 'm' ? 'm' : 'ft');
	                    const checkedByName = displayUserName(activePoDetails.po.checkPoUserId);
	                    const sentByName = displayUserName(activePoDetails.po.sentBy);
	                    return (
	                      <tr key={`${String(it.itemId ?? idx)}-${idx}`}>
                        {idx === 0 ? (
                          <>
	                            <td rowSpan={rowSpan} className="px-2 py-2 text-sm font-semibold text-on-surface border border-black align-top break-words">
	                              {formatPoNumber(activePoDetails.po.poNumber ?? activePoDetails.po.id) || '-'}
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
	                          {formatItemInline(it.item, it.specificationsJson, specNameById)}
	                        </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top">{it.unit || '-'}</td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top">
                            {Number(it.dimLength) || '-'}
                            {(() => {
                              const conv = getConvertedDim(String(it.dimLength ?? ''), baseDimUnitForAreaUnit(areaUnit));
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top">
                            {Number(it.dimBreadth) || '-'}
                            {(() => {
                              const conv = getConvertedDim(String(it.dimBreadth ?? ''), baseDimUnitForAreaUnit(areaUnit));
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top">{Number(it.dimPcs) || '-'}</td>
	                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top">{String((it as any).priority ?? (active as any)?.priority ?? '').trim() || '-'}</td>
	                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">
                            {Number(it.quantity ?? 0)}
                            {(() => {
                              const conv = getConvertedArea(String(it.quantity ?? ''), areaUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{Number(it.rate ?? 0)}</td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.discountPercent ?? '-'}</td>
                        <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums">{it.taxPercent ?? '-'}</td>
                        <td className="px-2 py-2 border border-black align-top">
                          {isAreaUnit ? (
                            <div className="grid grid-cols-4 gap-1">
                              <select
                                className={cn(inputClass, 'py-1.5')}
                                value={inputUnit}
                                onChange={(e) => setInputUnitByItemId((prev) => ({ ...prev, [it.itemId]: (e.target.value === 'm' ? 'm' : 'ft') as any }))}
                              >
                                <option value="ft">ft</option>
                                <option value="m">m</option>
                              </select>
                              <input
                                className={cn(inputClass, 'py-1.5')}
                                value={dims.length}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDimsByItemId((prev) => ({ ...prev, [it.itemId]: { ...(prev[it.itemId] ?? dims), length: v } }));
                                  const q = convertAreaQty(computeAreaQty(Number(v), Number(dims.breadth), Number(dims.pcs || 1)), inputUnit, poDimUnit);
                                  setQtyByItemId((prev) => ({ ...prev, [it.itemId]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                }}
                                inputMode="decimal"
                                placeholder={`L (${inputUnit})`}
                              />
                              <input
                                className={cn(inputClass, 'py-1.5')}
                                value={dims.breadth}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDimsByItemId((prev) => ({ ...prev, [it.itemId]: { ...(prev[it.itemId] ?? dims), breadth: v } }));
                                  const q = convertAreaQty(computeAreaQty(Number(dims.length), Number(v), Number(dims.pcs || 1)), inputUnit, poDimUnit);
                                  setQtyByItemId((prev) => ({ ...prev, [it.itemId]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                }}
                                inputMode="decimal"
                                placeholder={`B (${inputUnit})`}
                              />
                              <input
                                className={cn(inputClass, 'py-1.5')}
                                value={dims.pcs}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDimsByItemId((prev) => ({ ...prev, [it.itemId]: { ...(prev[it.itemId] ?? dims), pcs: v } }));
                                  const q = convertAreaQty(computeAreaQty(Number(dims.length), Number(dims.breadth), Number(v || 1)), inputUnit, poDimUnit);
                                  setQtyByItemId((prev) => ({ ...prev, [it.itemId]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                }}
                                inputMode="numeric"
                                placeholder="PCs"
                                />
                                </div>
                                <div className="flex flex-wrap gap-2 px-1">
                                {(() => {
                                const convL = getConvertedDim(dims.length, inputUnit);
                                return convL ? <div className="text-[10px] text-red-600 font-medium">L: {convL}</div> : null;
                                })()}
                                {(() => {
                                const convB = getConvertedDim(dims.breadth, inputUnit);
                                return convB ? <div className="text-[10px] text-red-600 font-medium">B: {convB}</div> : null;
                                })()}
                                {(() => {
                                const qStr = qtyByItemId[it.itemId];
                                const convQ = getConvertedArea(qStr, inputUnit === 'm' ? 'sqm' : 'sqft');
                                return convQ ? <div className="text-[10px] text-red-600 font-medium">Total: {convQ}</div> : null;
                                })()}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <input
                              className={cn(inputClass, 'py-1.5')}
                              value={qtyByItemId[it.itemId] ?? String(pendingQty)}
                              onChange={(e) => setQtyByItemId((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
                              inputMode="decimal"
                            />
                          )}
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
