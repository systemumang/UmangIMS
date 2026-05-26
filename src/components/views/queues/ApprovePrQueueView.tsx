import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { approvePr, fetchRequest, rejectPr, statusPillClass, type PurchaseRequestDetail } from '@/src/lib/purchaseRequests';
import { fetchQueueApprovePr, type ApprovePrQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatPrNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';
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
        for (const it of d.items) next[it.id] = String(it.quantity ?? 0);
        setQtyByItemId(next);
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
        <div className="text-sm text-on-surface-variant">Pending Tasks / Approve PR</div>
        <ExportCsvButton id="pending-export-btn" filename={`queue-approve-pr-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} showSupplier={false} showDepartment={false} />

      {loading ? (
        <LoadingCard label="Loading pending PR approvals..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
	      ) : (
	        <QueueCard title="Approve PR" subtitle={`${rows.length} pending`}>
	          <div className="overflow-x-auto">
			            <table className="w-full min-w-[1140px] table-fixed text-left border-collapse border border-outline-variant">
		              <colgroup>
		                <col className="w-[120px]" />
		                <col className="w-[170px]" />
		                <col className="w-[140px]" />
		                <col className="w-[160px]" />
		                <col className="w-[140px]" />
			                <col className="w-[120px]" />
			                <col className="w-[140px]" />
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
			                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Priority</th>
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
			                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{String((r as any).priority ?? '').trim() || '-'}</td>
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
	                        <td className="px-3 py-3 border border-outline-variant bg-surface-container-low" colSpan={8}>
                          {expandedLoading ? (
                            <div className="text-sm text-on-surface-variant">Loading items...</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[760px] table-fixed text-left border-collapse border border-outline-variant">
                                <colgroup>
                                  <col className="w-[520px]" />
                                  <col className="w-[120px]" />
                                  <col className="w-[120px]" />
                                </colgroup>
                                <thead>
                                  <tr className="bg-surface-container-high">
                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested Qty</th>
                                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Current Stock</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedItems.map((it) => (
                                    <tr key={it.id}>
                                      <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
                                        {formatItemWithSpecification(it.item, it.specification, specNameById)}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it.quantity}</td>
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
				        title={
				          modalMode === 'approve'
				            ? `Approve ${formatPrNumber(activeDetail?.pr?.prNumber ?? activePrId ?? '')}`
				            : `Reject ${formatPrNumber(activeDetail?.pr?.prNumber ?? activePrId ?? '')}`
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
                      return { id: it.id, quantity: q, itemId: it.itemId, item: it.item, specification: it.specification };
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
        maxWidthClass="max-w-5xl"
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
              <div className="text-sm text-on-surface-variant">Loading items...</div>
            ) : (
              <div className="overflow-x-auto">
	                <table className="w-full min-w-[860px] table-fixed text-left border-collapse border border-outline-variant">
		                  <colgroup>
		                    <col className="w-[460px]" />
		                    <col className="w-[130px]" />
		                    <col className="w-[130px]" />
		                    <col className="w-[140px]" />
		                  </colgroup>
	                  <thead>
	                    <tr className="bg-surface-container-high">
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested Qty</th>
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Current Stock</th>
		                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Approve Qty</th>
		                    </tr>
	                  </thead>
	                  <tbody>
	                    {activeDetail.items.map((it) => (
	                      <tr key={it.id}>
		                        <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
		                          {formatItemWithSpecification(it.item, it.specification, specNameById)}
		                        </td>
		                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it.quantity}</td>
		                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">
		                          {Number(modalStockByItemId[it.itemId] ?? 0).toFixed(2)}
		                        </td>
		                        <td className="px-3 py-2 border border-outline-variant">
	                          <input
	                            className={cn(inputClass, 'py-1.5')}
                            value={qtyByItemId[it.id] ?? ''}
                            onChange={(e) => setQtyByItemId((prev) => ({ ...prev, [it.id]: e.target.value }))}
                            inputMode="decimal"
                          />
                        </td>
	                      </tr>
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

