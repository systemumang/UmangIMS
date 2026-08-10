import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { createGrnForPo, fetchPendingGrnItems, fetchPos, type Po, type PoItem } from '@/src/lib/purchaseRequests';
import { fetchQueueCreateGrn, type CreateGrnQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { formatMax2 } from '@/src/lib/formatNumber';
import { sanitizeDecimalInput, sanitizeSignedDecimalInput } from '@/src/lib/numberInput';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import { formatPoNumber, formatPrNumber } from '@/src/lib/docNumbers';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type PendingItem = { poItemId?: string; itemId: string; item: string; unit?: string | null; pendingQty: number; rate: number };

export default function CreateGrnQueueView({
  onViewPr,
  poType = 'Goods',
  viewLabel = 'Create GRN',
  receiptLabel = 'GRN',
}: {
  onViewPr: (prId: string) => void;
  poType?: 'Goods' | 'Services';
  viewLabel?: string;
  receiptLabel?: string;
}) {
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
    return Math.round(n * 1000) / 1000;
  }

  function computeAreaQty(length: number, breadth: number, pcs: number) {
    const l = round2(length);
    const b = round2(breadth);
    const p = Math.trunc(pcs);
    if (!Number.isFinite(l) || l <= 0) return NaN;
    if (!Number.isFinite(b) || b <= 0) return NaN;
    if (!Number.isFinite(p) || p < 1) return NaN;
    return round2(l * b * p);
  }

  function convertAreaQty(qty: number, fromDimUnit: string, toDimUnit: string) {
    const q = Number(qty);
    const fromU = String(fromDimUnit ?? '').trim().toLowerCase();
    const toU = String(toDimUnit ?? '').trim().toLowerCase();
    if (!Number.isFinite(q)) return NaN;
    if (!fromU || !toU || fromU === toU) return round2(q);
    const M2_TO_FT2 = 10.7639104167;
    if (fromU === 'm' && toU === 'ft') return round2(q * M2_TO_FT2);
    if (fromU === 'ft' && toU === 'm') return round2(q / M2_TO_FT2);
    return NaN;
  }

  function getConvertedDim(val: string, from: 'ft' | 'm' | '') {
    const n = Number(val);
    if (!val || !Number.isFinite(n) || n <= 0 || !from) return null;
    if (from === 'ft') return `${(n / 3.28084).toFixed(3)} m`;
    if (from === 'm') return `${(n * 3.28084).toFixed(3)} Ft`;
    return null;
  }

  function getConvertedArea(val: string, from: 'sqft' | 'sqm' | null) {
    const n = Number(val);
    if (!val || !Number.isFinite(n) || n <= 0 || !from) return null;
    if (from === 'sqft') return `${(n / 10.7639).toFixed(3)} Sq Mtr`;
    if (from === 'sqm') return `${(n * 10.7639).toFixed(3)} Sq Ft`;
    return null;
  }

  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', projectId: '', supplierId: '', from: '', to: '', poType });
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
    fetchQueueCreateGrn({ ...filters, poType }, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [filters, poType]);

  useEffect(() => {
    setPage(1);
    setSelectedRowId(null);
  }, [filters, poType]);

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
	  const [weightByItemId, setWeightByItemId] = useState<Record<string, string>>({});
	  const [roundOffByItemId, setRoundOffByItemId] = useState<Record<string, string>>({});
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
	    setWeightByItemId({});
	    setRoundOffByItemId({});
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
	        for (const [idx, it] of items.entries()) draft[getLineKey(it, idx)] = String(it.pendingQty ?? 0);
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

	  function getLineKey(row: { id?: string; poItemId?: string; itemId?: string }, fallbackIndex = 0) {
	    const poItemId = String((row as any)?.poItemId ?? (row as any)?.id ?? '').trim();
	    if (poItemId) return poItemId;
	    return `${String(row?.itemId ?? '').trim()}::${fallbackIndex}`;
	  }

	  function samePoLine(a: { id?: string; poItemId?: string; itemId?: string }, b: { id?: string; poItemId?: string; itemId?: string }) {
	    const aPoItemId = String((a as any)?.poItemId ?? (a as any)?.id ?? '').trim();
	    const bPoItemId = String((b as any)?.poItemId ?? (b as any)?.id ?? '').trim();
	    if (aPoItemId || bPoItemId) return !!aPoItemId && aPoItemId === bPoItemId;
	    return String(a?.itemId ?? '').trim() === String(b?.itemId ?? '').trim();
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
        <div className="text-sm text-on-surface-variant">{viewLabel}</div>
        <ExportCsvButton id="pending-export-btn" filename={`queue-${receiptLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

      {loading ? (
        <LoadingCard label={`Loading POs pending ${receiptLabel}...`} />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title={viewLabel} subtitle={`${rows.length} pending`} hideHeader>
          <div className="overflow-x-auto">
	            <table className="w-full min-w-[1260px] table-fixed text-left border-collapse border border-outline-variant">
	              <colgroup>
	                <col className="w-[150px]" />
	                <col className="w-[140px]" />
	                <col className="w-[190px]" />
	                <col className="w-[200px]" />
	                <col className="w-[120px]" />
	                <col className="w-[120px]" />
	                <col className="w-[120px]" />
	                <col className="w-[140px]" />
	              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO Qty</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">{receiptLabel} Qty</th>
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
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{formatMax2((r as any).poQty ?? 0)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{formatMax2((r as any).grnQty ?? 0)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{formatMax2(r.pendingQty)}</td>
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
                            {viewLabel}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-3 border border-outline-variant bg-surface-container-lowest">
                          {isExpandedLoading ? <div className="text-sm text-on-surface-variant">Loading PO item details...</div> : null}
                          {!isExpandedLoading && expandedError ? <div className="text-sm text-error">{expandedError}</div> : null}
                          {!isExpandedLoading && !expandedError ? (
                            <div className="overflow-x-auto">
	                              <table className="w-full min-w-[1140px] table-fixed text-left border-collapse border border-outline-variant text-sm">
	                                <thead>
	                                  <tr className="bg-surface-container-high">
	                                    <th className="px-3 py-2 border border-outline-variant">Item</th>
                                      <th className="px-3 py-2 border border-outline-variant w-[80px]">Unit</th>
                                      <th className="px-3 py-2 border border-outline-variant w-[120px]">Length</th>
                                      <th className="px-3 py-2 border border-outline-variant w-[120px]">Breadth</th>
                                      <th className="px-3 py-2 border border-outline-variant w-[80px]">PCs</th>
                                      <th className="px-3 py-2 border border-outline-variant w-[100px]">Priority</th>
	                                    <th className="px-3 py-2 border border-outline-variant w-[120px]">{`Pending ${receiptLabel} Qty`}</th>
	                                  </tr>
	                                </thead>
	                                <tbody>
	                                  {expandedItems.length ? (
	                                    expandedItems
                                        .filter((it) => !selectedItemId || it.itemId === selectedItemId)
                                        .map((it) => {
                                          const rawIt = it as any;
                                          const unit = String(it.unit ?? '').trim();
                                          const areaUnit = normalizeAreaUnitName(unit);
                                          const dimL = rawIt.dimLength ?? rawIt.dim_length;
                                          const dimB = rawIt.dimBreadth ?? rawIt.dim_breadth;
                                          const dimP = rawIt.dimPcs ?? rawIt.dim_pcs;
                                          const rawDimUnit = String(rawIt.dimUnit ?? rawIt.dim_unit ?? '').trim();
                                          const dimUnit = rawDimUnit || baseDimUnitForAreaUnit(areaUnit);

                                          return (
	                                      <tr
	                                            key={getLineKey(it, 0)}
                                            className={cn('cursor-pointer hover:bg-surface-container-low transition-colors', selectedItemId === it.itemId && 'bg-primary/10')}
                                            onClick={() => setSelectedItemId(selectedItemId === it.itemId ? null : it.itemId)}
                                          >
	                                        <td className="px-3 py-2 border border-outline-variant whitespace-normal break-words">{it.item}</td>
                                          <td className="px-3 py-2 border border-outline-variant">{unit || '-'}</td>
                                          <td className="px-3 py-2 border border-outline-variant">
                                            {Number(dimL) || '-'}
                                            {(() => {
                                              const conv = getConvertedDim(String(dimL ?? ''), dimUnit);
                                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                                            })()}
                                          </td>
                                          <td className="px-3 py-2 border border-outline-variant">
                                            {Number(dimB) || '-'}
                                            {(() => {
                                              const conv = getConvertedDim(String(dimB ?? ''), dimUnit);
                                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                                            })()}
                                          </td>
                                          <td className="px-3 py-2 border border-outline-variant">{Number(dimP) || '-'}</td>
                                          <td className="px-3 py-2 border border-outline-variant">{String(rawIt.priority ?? (r as any).priority ?? '').trim() || '-'}</td>
	                                        <td className="px-3 py-2 border border-outline-variant tabular-nums">
                                            {formatMax2(it.pendingQty ?? 0)}
                                            {unit ? <span className="ml-1 text-[10px] text-on-surface-variant font-bold opacity-60 uppercase">{unit}</span> : null}
                                            {(() => {
                                              const conv = getConvertedArea(String(it.pendingQty ?? ''), areaUnit);
                                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                                            })()}
                                          </td>
	                                      </tr>
	                                    )})
	                                  ) : (
	                                    <tr>
	                                      <td className="px-3 py-3 border border-outline-variant text-on-surface-variant" colSpan={7}>
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
        title={`Pending PO for ${receiptLabel} (1)`}
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
	                    const poItem = (activePoDetails.items ?? []).find((x) => samePoLine(x as any, it as any));
	                    const lineKey = getLineKey(it, 0);
                    const poDimUnit =
                      String((poItem as any)?.dimUnit ?? '').trim() ||
                      baseDimUnitForAreaUnit(normalizeAreaUnitName(String((poItem as any)?.unit ?? '')));
                    const isArea = poDimUnit === 'ft' || poDimUnit === 'm';
	                    const dims = dimsByItemId[lineKey] ?? { length: '', breadth: '', pcs: '1' };
	                    const inputUnit = (inputUnitByItemId[lineKey] ?? (poDimUnit === 'm' ? 'm' : 'ft')) as 'ft' | 'm';
                    const qtyInputUnit = isArea ? computeAreaQty(Number(dims.length), Number(dims.breadth), Number(dims.pcs || 1)) : NaN;
                    const q = isArea ? convertAreaQty(qtyInputUnit, inputUnit, poDimUnit) : (() => {
	                      const raw = qtyByItemId[lineKey];
                      return raw != null && String(raw).trim() ? Number(raw) : 0;
	                    })();
		                    const weight = weightByItemId[lineKey];
		                    const ro = roundOffByItemId[lineKey];
		                    return {
	                      poItemId: it.poItemId,
		                      itemId: it.itemId,
	                      item: it.item,
	                      quantityReceived: q,
	                      weight: String(weight ?? '').trim() ? Number(weight) : undefined,
	                      roundOff: String(ro ?? '').trim() ? Number(ro) : undefined,
                      pendingQty: it.pendingQty,
                      ...(isArea ? { length: Number(dims.length), breadth: Number(dims.breadth), pcs: Number(dims.pcs || 1), inputUnit } : {}),
                    };
                  })
                  .filter((x) => x.quantityReceived > 0 || (x.roundOff != null && Math.abs(x.roundOff) > 0));
                
                if (!items.length) {
                  setModalError('Enter Received Qty or Round Off for at least one item.');
                  return;
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
	                    poItemId: (x as any).poItemId,
	                    itemId: x.itemId,
	                    item: x.item,
	                    quantityReceived: x.quantityReceived,
	                    weight: x.weight,
	                    roundOff: x.roundOff,
                    ...(('length' in x || 'breadth' in x || 'pcs' in x) ? { length: (x as any).length, breadth: (x as any).breadth, pcs: (x as any).pcs, inputUnit: (x as any).inputUnit } : {}),
                  })),
                })
                  .then(() => fetchQueueCreateGrn({ ...filters, poType }).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Creating...' : viewLabel}
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
	                <col className="w-[120px]" />
	                <col className="w-[160px]" />
	                <col className="w-[300px]" />
                  <col className="w-[80px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
                  <col className="w-[80px]" />
                  <col className="w-[110px]" />
                  <col className="w-[120px]" />
                  <col className="w-[70px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
	                  <col className="w-[80px]" />
	                  <col className="w-[100px]" />
	                  <col className="w-[100px]" />
	                  <col className="w-[120px]" />
              </colgroup>
              <thead>
                <tr className="bg-blue-700">
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">PO No</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Supplier</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black">Items</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-center">Unit</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-center">Length</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-center">Breadth</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-center">PCs</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-right">PO Qty</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black text-right">{`Pending ${receiptLabel} Qty`}</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">{receiptLabel} Unit</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">{receiptLabel} L</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">{receiptLabel} B</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">{receiptLabel} PCs</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">Weight</th>
	                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">Round Off</th>
                  <th className="px-2 py-2 text-[11px] font-bold text-white uppercase tracking-widest border border-black bg-orange-500 text-center">{receiptLabel} Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {(activePoDetails.items.length ? activePoDetails.items : ([{ poId: activePoDetails.po.id, itemId: '', item: '-', quantity: 0, rate: 0 }] as any)).map(
              (it: PoItem, idx: number) => {
              const rowSpan = activePoDetails.items.length || 1;
	              const lineKey = getLineKey(it as any, idx);
	              const pendingRow = pendingItems.find((p) => samePoLine(it as any, p as any));
              const pendingQty = pendingRow ? Number(pendingRow.pendingQty ?? 0) : 0;

                      const raw = it as any;
                      const unit = String(it.unit ?? '').trim();
                      const areaUnit = normalizeAreaUnitName(unit);

                      const dimL = raw.dimLength ?? raw.dim_length;
                      const dimB = raw.dimBreadth ?? raw.dim_breadth;
                      const dimP = raw.dimPcs ?? raw.dim_pcs;
                      const rawDimUnit = String(raw.dimUnit ?? raw.dim_unit ?? '').trim();
                      const dimUnit = rawDimUnit || baseDimUnitForAreaUnit(areaUnit);

                      const poDimUnit = dimUnit;
                      const isAreaUnit = !!areaUnit;
	                      const dims = dimsByItemId[lineKey] ?? { length: '', breadth: '', pcs: '1' };
	                      const inputUnit = inputUnitByItemId[lineKey] ?? (poDimUnit === 'm' ? 'm' : 'ft');

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
                          </>
                        ) : null}
              <td className="px-2 py-2 text-sm text-on-surface border border-black align-top whitespace-normal break-words">
              {formatItemInline(it.item, it.specificationsJson, specNameById)}
              </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top text-center">{unit || '-'}</td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top text-center">
                            {dimL ? `${formatMax2(dimL)} ${dimUnit}` : '-'}
                            {(() => {
                              const conv = getConvertedDim(String(dimL ?? ''), dimUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top text-center">
                            {dimB ? `${formatMax2(dimB)} ${dimUnit}` : '-'}
                            {(() => {
                              const conv = getConvertedDim(String(dimB ?? ''), dimUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top text-center">{Number(dimP) ? formatMax2(dimP) : '-'}</td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums text-right">
                            {formatMax2(it.quantity ?? 0)}
                            {(() => {
                              const conv = getConvertedArea(String(it.quantity ?? ''), areaUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium mt-0.5">{conv}</div> : null;
                            })()}
                          </td>
                          <td className="px-2 py-2 text-sm text-on-surface-variant border border-black align-top tabular-nums text-right">
                            {formatMax2(pendingQty)}
                          </td>
                        
                        {/* Receipt input columns */}
                        <td className="px-1 py-2 border border-black align-top">
                          {isAreaUnit ? (
                            <select
                              className={cn(inputClass, 'py-1 px-1 h-8 text-xs')}
                              value={inputUnit}
	                              onChange={(e) => setInputUnitByItemId((prev) => ({ ...prev, [lineKey]: (e.target.value === 'm' ? 'm' : 'ft') as any }))}
                            >
                              <option value="ft">ft</option>
                              <option value="m">m</option>
                            </select>
                          ) : '-'}
                        </td>
                        <td className="px-1 py-2 border border-black align-top">
                          {isAreaUnit ? (
                            <div className="space-y-1">
                              <div className="relative">
                                <input
                                  className={cn(inputClass, 'py-1 pl-2 pr-6 h-8 text-xs')}
                                  value={dims.length}
                                  onChange={(e) => {
	                                    const v = sanitizeDecimalInput(e.target.value);
	                                    setDimsByItemId((prev) => ({ ...prev, [lineKey]: { ...(prev[lineKey] ?? dims), length: v } }));
	                                    const q = convertAreaQty(computeAreaQty(Number(v), Number(dims.breadth), Number(dims.pcs || 1)), inputUnit, poDimUnit);
	                                    setQtyByItemId((prev) => ({ ...prev, [lineKey]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                  }}
                                  inputMode="decimal"
                                  placeholder="L"
                                />
                                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant/60 font-bold pointer-events-none">
                                  {inputUnit === 'm' ? 'm' : 'Ft'}
                                </div>
                              </div>
                              {(() => {
                                const convL = getConvertedDim(dims.length, inputUnit);
                                return convL ? <div className="text-[10px] text-red-600 font-medium leading-tight">{convL}</div> : null;
                              })()}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-1 py-2 border border-black align-top">
                          {isAreaUnit ? (
                            <div className="space-y-1">
                              <div className="relative">
                                <input
                                  className={cn(inputClass, 'py-1 pl-2 pr-6 h-8 text-xs')}
                                  value={dims.breadth}
                                  onChange={(e) => {
	                                    const v = sanitizeDecimalInput(e.target.value);
	                                    setDimsByItemId((prev) => ({ ...prev, [lineKey]: { ...(prev[lineKey] ?? dims), breadth: v } }));
	                                    const q = convertAreaQty(computeAreaQty(Number(dims.length), Number(v), Number(dims.pcs || 1)), inputUnit, poDimUnit);
	                                    setQtyByItemId((prev) => ({ ...prev, [lineKey]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                  }}
                                  inputMode="decimal"
                                  placeholder="B"
                                />
                                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant/60 font-bold pointer-events-none">
                                  {inputUnit === 'm' ? 'm' : 'Ft'}
                                </div>
                              </div>
                              {(() => {
                                const convB = getConvertedDim(dims.breadth, inputUnit);
                                return convB ? <div className="text-[10px] text-red-600 font-medium leading-tight">{convB}</div> : null;
                              })()}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-1 py-2 border border-black align-top">
                          {isAreaUnit ? (
                            <input
                              className={cn(inputClass, 'py-1 px-2 h-8 text-xs')}
                              value={dims.pcs}
                              onChange={(e) => {
                                const v = e.target.value;
	                                setDimsByItemId((prev) => ({ ...prev, [lineKey]: { ...(prev[lineKey] ?? dims), pcs: v } }));
	                                const q = convertAreaQty(computeAreaQty(Number(dims.length), Number(dims.breadth), Number(v || 1)), inputUnit, poDimUnit);
	                                setQtyByItemId((prev) => ({ ...prev, [lineKey]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                              }}
                              inputMode="numeric"
                              placeholder="PCs"
                            />
	                          ) : '-'}
	                        </td>
	                        <td className="px-1 py-2 border border-black align-top">
	                          <input
	                            className={cn(inputClass, 'py-1 px-2 h-8 text-xs text-right')}
		                            value={weightByItemId[lineKey] ?? ''}
		                            onChange={(e) =>
		                              setWeightByItemId((prev) => ({ ...prev, [lineKey]: sanitizeDecimalInput(e.target.value) }))
		                            }
	                            inputMode="decimal"
	                            placeholder="Weight"
	                          />
	                        </td>
	                        <td className="px-1 py-2 border border-black align-top">
	                          <input
                            className={cn(inputClass, 'py-1 px-2 h-8 text-xs text-right disabled:bg-surface-container-low disabled:opacity-50')}
	                            value={roundOffByItemId[lineKey] ?? ''}
			                            onChange={(e) =>
			                              setRoundOffByItemId((prev) => ({ ...prev, [lineKey]: sanitizeSignedDecimalInput(e.target.value) }))
			                            }
                            inputMode="decimal"
                            placeholder={isAreaUnit ? "0.00" : "-"}
                            disabled={!isAreaUnit}
                          />
                        </td>
                        <td className="px-1 py-2 border border-black align-top">
                          <div className="space-y-1">
                            <div className="relative">
                              <input
                                className={cn(inputClass, 'py-1 pl-2 pr-12 h-8 text-xs text-right bg-surface-container-low font-bold')}
                                value={(() => {
	                                  const q = qtyByItemId[lineKey] ?? String(pendingQty);
                                  if (!isAreaUnit) return q;
	                                  const ro = Number(roundOffByItemId[lineKey] || 0);
                                  if (ro === 0) return q;
                                  return (round2(Number(q) + ro)).toFixed(3);
                                })()}
	                                onChange={(e) =>
		                                  setQtyByItemId((prev) => ({ ...prev, [lineKey]: sanitizeDecimalInput(e.target.value) }))
	                                }
                                inputMode="decimal"
                                disabled={isAreaUnit}
                              />
                              {(isAreaUnit || unit) && (
                                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-on-surface-variant/60 font-bold pointer-events-none uppercase">
                                  {isAreaUnit ? (areaUnit === 'sqm' ? 'Sq Mtr' : 'Sq Ft') : unit}
                                </div>
                              )}
                            </div>
                            {isAreaUnit ? (() => {
	                              const qStr = qtyByItemId[lineKey];
                              if (!qStr) return null;
                              const areaInInputUnit = computeAreaQty(Number(dims.length), Number(dims.breadth), Number(dims.pcs || 1));
                              const inputAreaUnitLabel = inputUnit === 'm' ? 'sqm' : 'sqft';
                              const poAreaUnitLabel = areaUnit === 'sqm' ? 'sqm' : 'sqft';
                              
                              return (
                                <div className="space-y-0.5">
                                  <div className="text-[10px] text-blue-700 font-bold leading-tight">
                                    Area: {areaInInputUnit.toFixed(3)} {inputAreaUnitLabel}
                                  </div>
                                  {inputAreaUnitLabel !== poAreaUnitLabel && (
                                    <div className="text-[10px] text-red-600 font-medium leading-tight">
                                      (= {Math.trunc(Number(qStr) || 0)} {poAreaUnitLabel})
                                    </div>
                                  )}
                                </div>
                              );
                            })() : (() => {
	                              const q = Number(qtyByItemId[lineKey] ?? pendingQty);
	                              const ro = Number(roundOffByItemId[lineKey] || 0);
                              if (ro === 0) return null;
                              return (
                                <div className="text-[10px] text-blue-800 font-bold text-right pr-1">
                                  Total: {round2(q + ro).toFixed(3)}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
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
