import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { approvePr, fetchRequest, rejectPr, statusPillClass, type PurchaseRequestDetail } from '@/src/lib/purchaseRequests';
import { fetchQueueApprovePr, type ApprovePrQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatPrNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';
import Spinner from '@/src/components/common/Spinner';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { fetchInventorySheet } from '@/src/lib/inventory';

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());
}

function formatSpecsLinesFromMaybeJson(spec: string, specNameById?: Record<string, string>) {
  const s = String(spec ?? '').trim();
  if (!s) return [];

  // Newer PR flow stores specs as JSON: {"<specId>":"<value>"}
  const looksJson = s.startsWith('{') && s.endsWith('}');
  if (looksJson) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      return Object.entries(obj)
        .map(([k, v]) => {
          const rawKey = String(k ?? '').trim();
          const rawVal = typeof v === 'string' ? String(v ?? '').trim() : String(v ?? '').trim();
          const keyName = specNameById?.[rawKey] ?? (isUuidLike(rawKey) ? '' : rawKey);
          const valueText = isUuidLike(rawVal) ? '' : rawVal;
          if (!keyName && !valueText) return '';
          if (!keyName) return valueText;
          if (!valueText) return keyName;
          return `${keyName}: ${valueText}`;
        })
        .map((x) => x.trim())
        .filter(Boolean);
    } catch {
      // fallthrough to plain text
    }
  }

  // Legacy text lines
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !isUuidLike(x));
}

function formatItemWithSpecification(item: string, specification: string, specNameById?: Record<string, string>) {
  const base = String(item ?? '').trim();
  const specs = formatSpecsLinesFromMaybeJson(specification, specNameById);
  if (!specs.length) return base || '-';
  return [base, ...specs].filter(Boolean).join(' - ');
}

export default function ApprovePrQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
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
    return round2(l * b * p);
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

  const masters = useQueueMasters({ includeUsers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', from: '', to: '' });
  const [rows, setRows] = useState<ApprovePrQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'approve' | 'reject'>('approve');
  const [activePrId, setActivePrId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<PurchaseRequestDetail | null>(null);
  const [approverUserId, setApproverUserId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [qtyByItemId, setQtyByItemId] = useState<Record<string, string>>({});
  const [dimsByItemId, setDimsByItemId] = useState<Record<string, { length: string; breadth: string; pcs: string }>>({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [expandedPrId, setExpandedPrId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<PurchaseRequestDetail['items']>([]);
  const [expandedStockByItemId, setExpandedStockByItemId] = useState<Record<string, number>>({});
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [modalStockByItemId, setModalStockByItemId] = useState<Record<string, number>>({});

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal)
      .then(setSpecs)
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    if (!modalOpen) return;
    if (approverUserId) return;
    if (masters.loading) return;
    if (masters.users.length) setApproverUserId(masters.users[0]!.id);
  }, [approverUserId, masters.loading, masters.users, modalOpen]);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, departments: masters.departments, projects: masters.projects, suppliers: [] }),
    [masters.departments, masters.firms, masters.projects]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueApprovePr(filters, ac.signal)
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

  useEffect(() => {
    if (!modalOpen || !activePrId) return;
    const ac = new AbortController();
    setActiveDetail(null);
    setModalError(null);
    setModalStockByItemId({});
    fetchRequest(activePrId, ac.signal)
      .then(async (d) => {
        setActiveDetail(d);
        const next: Record<string, string> = {};
        const dimsNext: Record<string, { length: string; breadth: string; pcs: string }> = {};
        for (const it of d.items) {
          const areaUnit = normalizeAreaUnitName(String((it as any).unit ?? ''));
          const isArea = !!areaUnit;
          const length = String((it as any).approvedDimLength ?? (it as any).dimLength ?? '').trim();
          const breadth = String((it as any).approvedDimBreadth ?? (it as any).dimBreadth ?? '').trim();
          const pcs = String((it as any).approvedDimPcs ?? (it as any).dimPcs ?? '1').trim() || '1';
          if (isArea) {
            dimsNext[it.id] = { length, breadth, pcs };
            const q = computeAreaQty(Number(length), Number(breadth), Number(pcs));
            next[it.id] = Number.isFinite(q) && q > 0 ? String(q) : '';
          } else {
            next[it.id] = String((it as any).approvedQty ?? it.quantity ?? 0);
          }
        }
        setQtyByItemId(next);
        setDimsByItemId(dimsNext);
        const invRows = await fetchInventorySheet(String(d.pr.firmId ?? ''), undefined, ac.signal, { includeEmpty: true });
        const byItem: Record<string, number> = {};
        for (const row of invRows ?? []) {
          const itemId = String((row as any).itemId ?? '').trim();
          if (!itemId) continue;
          byItem[itemId] = (byItem[itemId] ?? 0) + Number((row as any).balance ?? 0);
        }
        setModalStockByItemId(byItem);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [activePrId, modalOpen]);

  useEffect(() => {
    if (!expandedPrId) {
      setExpandedItems([]);
      setExpandedStockByItemId({});
      return;
    }
    const ac = new AbortController();
    setExpandedLoading(true);
    fetchRequest(expandedPrId, ac.signal)
      .then(async (d) => {
        setExpandedItems(d.items ?? []);
        const invRows = await fetchInventorySheet(String(d.pr.firmId ?? ''), undefined, ac.signal, { includeEmpty: true });
        const byItem: Record<string, number> = {};
        for (const row of invRows ?? []) {
          const itemId = String((row as any).itemId ?? '').trim();
          if (!itemId) continue;
          byItem[itemId] = (byItem[itemId] ?? 0) + Number((row as any).balance ?? 0);
        }
        setExpandedStockByItemId(byItem);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setExpandedItems([]);
        setExpandedStockByItemId({});
      })
      .finally(() => setExpandedLoading(false));
    return () => ac.abort();
  }, [expandedPrId]);

  function closeModal() {
    setModalOpen(false);
    setActivePrId(null);
    setActiveDetail(null);
    setModalError(null);
    setSaving(false);
    setApproverUserId('');
    setRejectReason('');
  }

  const approverName = useMemo(() => {
    const u = masters.users.find((x) => x.id === approverUserId);
    return u?.name ? String(u.name) : '';
  }, [approverUserId, masters.users]);

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
      <div className="hidden">
        <div className="text-sm text-on-surface-variant">Approve PR</div>
        <ExportCsvButton id="pending-export-btn" filename={`queue-approve-pr-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} showSupplier={false} showDepartment={false} />

      {loading ? (
        <LoadingCard label="Loading pending PR approvals..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
	      ) : (
	        <QueueCard title="Approve PR" subtitle={`${rows.length} pending`} hideHeader>
	          <div className="overflow-x-auto">
				            <table className="w-full min-w-[1040px] table-fixed text-left border-collapse border border-outline-variant">
			              <colgroup>
			                <col className="w-[120px]" />
			                <col className="w-[170px]" />
			                <col className="w-[140px]" />
			                <col className="w-[160px]" />
			                <col className="w-[140px]" />
				                <col className="w-[120px]" />
				                <col className="w-[220px]" />
		              </colgroup>
	              <thead>
	                <tr className="bg-surface-container-high">
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PR</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Request Type</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Project</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested By</th>
				                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Req Date</th>
				                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
	                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <React.Fragment key={r.prId}>
                    <tr
                      className="cursor-pointer hover:bg-surface-container-low/50"
                      onClick={() => setExpandedPrId((prev) => (prev === r.prId ? null : r.prId))}
                    >
                    <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requestType ?? '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.projectName ?? '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requestedBy || '-'}</td>
				                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requisitionDate ? formatDateDDMMYYYYOnly(r.requisitionDate) : '-'}</td>
		                      <td className="px-3 py-2 border border-outline-variant">
	                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
	                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => {
                              setModalMode('approve');
                              setActivePrId(r.prId);
                              setModalOpen(true);
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            onClick={() => {
                              setModalMode('reject');
                              setActivePrId(r.prId);
                              setModalOpen(true);
                            }}
                          >
	                            Reject
	                          </button>
	                        </div>
	                      </td>
                    </tr>
                    {expandedPrId === r.prId ? (
                      <tr>
		                        <td className="px-3 py-3 border border-outline-variant bg-surface-container-low" colSpan={7}>
                          {expandedLoading ? (
                            <div className="text-sm text-on-surface-variant">Loading items...</div>
                          ) : (
                            <div className="overflow-x-auto">
	                              <table className="w-full min-w-[900px] table-fixed text-left border-collapse border border-outline-variant">
	                                <colgroup>
	                                  <col className="w-[420px]" />
	                                  <col className="w-[160px]" />
	                                  <col className="w-[120px]" />
	                                  <col className="w-[100px]" />
	                                  <col className="w-[120px]" />
	                                </colgroup>
	                                <thead>
	                                  <tr className="bg-surface-container-high">
	                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Priority</th>
	                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested Qty</th>
	                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Unit</th>
	                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Current Stock</th>
	                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedItems.map((it) => (
	                                    <tr key={it.id}>
	                                      <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
	                                        {formatItemWithSpecification(it.item, it.specification, specNameById)}
	                                      </td>
                                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((it as any).priority ?? '').trim() || '-'}</td>
	                                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it.quantity}</td>
	                                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((it as any).unit ?? '').trim() || '-'}</td>
	                                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
	                                        {Number(expandedStockByItemId[it.itemId] ?? 0).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
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
					        title={
                    modalMode === 'approve'
                      ? activeDetail?.pr?.prNumber
                        ? `Approve ${formatPrNumber(activeDetail.pr.prNumber)}`
                        : 'Approve'
                      : activeDetail?.pr?.prNumber
                        ? `Reject ${formatPrNumber(activeDetail.pr.prNumber)}`
                        : 'Reject'
					        }
        onClose={() => (saving ? null : closeModal())}
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
	            <button
	              type="button"
	              className={modalMode === 'approve' ? 'btn-primary btn-sm' : 'btn-danger btn-sm'}
	              disabled={saving || !activePrId || !approverName.trim() || (modalMode === 'reject' && !rejectReason.trim())}
	              onClick={() => {
	                if (!activePrId) return;
	                setSaving(true);
	                setModalError(null);
	                const prId = activePrId;
	                if (modalMode === 'reject') {
	                  rejectPr(prId, approverName.trim(), rejectReason.trim())
	                    .then(() => fetchQueueApprovePr(filters).then(setRows))
	                    .then(() => closeModal())
	                    .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
	                    .finally(() => setSaving(false));
	                  return;
	                }
                const items =
                  activeDetail?.items
                    ?.map((it) => {
                      const raw = qtyByItemId[it.id];
                      const q = raw != null && String(raw).trim() ? Number(raw) : 0;
                      const areaUnit = normalizeAreaUnitName(String((it as any).unit ?? ''));
                      const isArea = !!areaUnit;
                      const d = dimsByItemId[it.id];
                      const length = d?.length != null && String(d.length).trim() ? Number(d.length) : NaN;
                      const breadth = d?.breadth != null && String(d.breadth).trim() ? Number(d.breadth) : NaN;
                      const pcs = d?.pcs != null && String(d.pcs).trim() ? Number(d.pcs) : 1;
                      return {
                        id: it.id,
                        quantity: q,
                        ...(isArea ? { length, breadth, pcs } : {}),
                        itemId: it.itemId,
                        item: it.item,
                        specification: it.specification,
                      };
                    })
	                    .filter((it) => Number.isFinite(it.quantity) && it.quantity > 0) ?? [];
	                approvePr(prId, approverName.trim(), items)
	                  .then(() => fetchQueueApprovePr(filters).then(setRows))
	                  .then(() => closeModal())
	                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
	                  .finally(() => setSaving(false));
	              }}
	            >
              {saving ? 'Saving...' : modalMode === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </>
        }
	        maxWidthClass="max-w-6xl"
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

	        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
			          <div>
			            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">
                    {modalMode === 'approve' ? 'Approved By' : 'Rejected By'}
                  </div>
		            <select
		              className={cn(inputClass, 'mt-1')}
		              value={approverUserId}
		              disabled={saving || masters.loading}
		              onChange={(e) => setApproverUserId(e.target.value)}
		            >
		              <option value="">{masters.loading ? 'Loading users...' : 'Select user'}</option>
		              {masters.users.map((u) => (
		                <option key={u.id} value={u.id}>
		                  {u.name}
		                </option>
		              ))}
		            </select>
		          </div>
	          {modalMode === 'reject' ? (
            <div>
              <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Reject Reason</div>
              <input className={cn(inputClass, 'mt-1')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason..." />
            </div>
          ) : (
            <div className="flex items-end">
              <div className="text-xs text-on-surface-variant">
                Status:{' '}
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                    statusPillClass('Pending Approval')
                  )}
                >
                  Pending Approval
                </span>
              </div>
            </div>
          )}
        </div>

	        {modalMode === 'approve' ? (
	          <div className="bg-surface-container rounded-xl border border-outline-variant/10 p-4 space-y-3">
	            {!activeDetail ? (
	              <div className="text-sm text-on-surface-variant inline-flex items-center gap-2"><Spinner className="h-4 w-4" /> Loading items...</div>
	            ) : (
	              <div className="overflow-x-auto">
		                <table className="w-full min-w-[1100px] table-fixed text-left border-collapse border border-outline-variant">
			                  <colgroup>
			                    <col className="w-[400px]" />
                              <col className="w-[140px]" />
			                    <col className="w-[110px]" />
			                    <col className="w-[100px]" />
			                    <col className="w-[110px]" />
			                    <col className="w-[110px]" />
			                    <col className="w-[110px]" />
			                    <col className="w-[80px]" />
			                    <col className="w-[130px]" />
			                  </colgroup>
		                  <thead>
		                    <tr className="bg-surface-container-high">
		                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Priority</th>
		                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested Qty</th>
		                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Unit</th>
		                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Current Stock</th>
                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant text-center">Length</th>
                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant text-center">Breadth</th>
                              <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant text-center">PCs</th>
			                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Approve Qty</th>
		                    </tr>
	                  </thead>
	                  <tbody>
	                    {activeDetail.items.map((it) => (
                        (() => {
                          const areaUnit = normalizeAreaUnitName(String((it as any).unit ?? ''));
                          const isArea = !!areaUnit;
                          const dimUnit = baseDimUnitForAreaUnit(areaUnit);
                          const d = dimsByItemId[it.id] ?? { length: '', breadth: '', pcs: '1' };
                          const qtyVal = qtyByItemId[it.id] ?? '';
                          return (
		                      <tr key={it.id}>
			                        <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
			                          {formatItemWithSpecification(it.item, it.specification, specNameById)}
			                        </td>
                                <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((it as any).priority ?? '').trim() || '-'}</td>
			                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it.quantity}</td>
			                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((it as any).unit ?? '').trim() || '-'}</td>
		                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
		                          {Number(modalStockByItemId[it.itemId] ?? 0).toFixed(2)}
		                        </td>
                            <td className="px-3 py-2 border border-outline-variant bg-surface-container-high/40">
                              {isArea ? (
                                <div className="space-y-1">
                                  <input
                                    className={cn(inputClass, 'py-1')}
                                    value={d.length}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setDimsByItemId((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? d), length: v } }));
                                      const q = computeAreaQty(Number(v), Number((dimsByItemId[it.id] ?? d).breadth), Number((dimsByItemId[it.id] ?? d).pcs));
                                      setQtyByItemId((prev) => ({ ...prev, [it.id]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                    }}
                                    inputMode="decimal"
                                    placeholder={dimUnit ? `L (${dimUnit})` : 'Length'}
                                  />
                                  {(() => {
                                    const conv = getConvertedDim(d.length, dimUnit);
                                    return conv ? <div className="text-[10px] text-red-600 font-medium px-1">{conv}</div> : null;
                                  })()}
                                </div>
                              ) : (
                                <div className="text-xs text-red-600 font-medium opacity-90 text-center">-</div>
                              )}
                            </td>
                            <td className="px-3 py-2 border border-outline-variant bg-surface-container-high/40">
                              {isArea ? (
                                <div className="space-y-1">
                                  <input
                                    className={cn(inputClass, 'py-1')}
                                    value={d.breadth}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setDimsByItemId((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? d), breadth: v } }));
                                      const q = computeAreaQty(Number((dimsByItemId[it.id] ?? d).length), Number(v), Number((dimsByItemId[it.id] ?? d).pcs));
                                      setQtyByItemId((prev) => ({ ...prev, [it.id]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                    }}
                                    inputMode="decimal"
                                    placeholder={dimUnit ? `B (${dimUnit})` : 'Breadth'}
                                  />
                                  {(() => {
                                    const conv = getConvertedDim(d.breadth, dimUnit);
                                    return conv ? <div className="text-[10px] text-red-600 font-medium px-1">{conv}</div> : null;
                                  })()}
                                </div>
                              ) : (
                                <div className="text-xs text-red-600 font-medium opacity-90 text-center">-</div>
                              )}
                            </td>
                            <td className="px-3 py-2 border border-outline-variant bg-surface-container-high/40">
                              {isArea ? (
                                <input
                                  className={cn(inputClass, 'py-1')}
                                  value={d.pcs}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setDimsByItemId((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? d), pcs: v } }));
                                    const q = computeAreaQty(Number((dimsByItemId[it.id] ?? d).length), Number((dimsByItemId[it.id] ?? d).breadth), Number(v));
                                    setQtyByItemId((prev) => ({ ...prev, [it.id]: Number.isFinite(q) && q > 0 ? String(q) : '' }));
                                  }}
                                  inputMode="numeric"
                                  placeholder="PCs"
                                />
                              ) : (
                                <div className="text-xs text-red-600 font-medium opacity-90 text-center">-</div>
                              )}
                            </td>
		                        <td className={cn('px-3 py-2 border border-outline-variant bg-surface-container-high/40')}>
                              <div className="space-y-1">
                                <input
                                  className={cn(inputClass, 'py-1')}
                                  value={qtyVal}
                                  disabled={isArea}
                                  onChange={(e) => (isArea ? null : setQtyByItemId((prev) => ({ ...prev, [it.id]: e.target.value })))}
                                  inputMode="decimal"
                                />
                                {(() => {
                                  const conv = getConvertedArea(qtyVal, areaUnit);
                                  return conv ? <div className="text-[10px] text-red-600 font-medium px-1">{conv}</div> : null;
                                })()}
                              </div>
                            </td>
	                      </tr>
                          );
                        })()
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

