import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { approvePr, fetchRequest, rejectPr, statusPillClass, type PurchaseRequestDetail } from '@/src/lib/purchaseRequests';
import { fetchQueueApprovePr, type ApprovePrQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatPrNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

function formatItemWithSpecification(item: string, specification: string) {
  const base = String(item ?? '').trim();
  const specs = String(specification ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!specs.length) return base || '-';
  return [base, ...specs].filter(Boolean).join(' - ');
}

export default function ApprovePrQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeUsers: true });
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
    fetchRequest(activePrId, ac.signal)
      .then((d) => {
        setActiveDetail(d);
        const next: Record<string, string> = {};
        for (const it of d.items) next[it.id] = String(it.quantity ?? 0);
        setQtyByItemId(next);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [activePrId, modalOpen]);

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
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} showSupplier={false} />
      <div className="flex justify-end">
        <ExportCsvButton filename={`queue-approve-pr-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>

      {loading ? (
        <LoadingCard label="Loading pending PR approvals..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
	      ) : (
	        <QueueCard title="Approve PR" subtitle={`${rows.length} pending`}>
	          <div className="overflow-x-auto">
		            <table className="w-full min-w-[1020px] table-fixed text-left border-collapse border border-outline-variant">
		              <colgroup>
		                <col className="w-[120px]" />
		                <col className="w-[170px]" />
		                <col className="w-[140px]" />
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
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Dept</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Project</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested By</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Req Date</th>
		                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
	                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
	                  pagedRows.map((r) => (
	                    <tr key={r.prId}>
	                    <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{formatPrNumber(r.prNumber ?? r.prId)}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requestType ?? '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.department}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.projectName ?? '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requestedBy || '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.requisitionDate ? formatDateDDMMYYYYOnly(r.requisitionDate) : '-'}</td>
		                      <td className="px-3 py-2 border border-outline-variant">
	                        <div className="flex items-center gap-2 flex-wrap">
	                          <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
	                            View PR
                          </button>
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
			            ? `Approve PR ${formatPrNumber(activeDetail?.pr?.prNumber ?? activePrId ?? '')}`
			            : `Reject PR ${formatPrNumber(activeDetail?.pr?.prNumber ?? activePrId ?? '')}`
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
		            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Approved / Rejected By</div>
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
	            <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Item-wise Approved Qty</div>
            {!activeDetail ? (
              <div className="text-sm text-on-surface-variant">Loading items...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-fixed text-left border-collapse border border-outline-variant">
	                  <colgroup>
	                    <col className="w-[540px]" />
	                    <col className="w-[160px]" />
	                    <col className="w-[160px]" />
	                  </colgroup>
                  <thead>
                    <tr className="bg-surface-container-high">
                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Requested Qty</th>
	                      <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Approve Qty</th>
	                    </tr>
                  </thead>
                  <tbody>
                    {activeDetail.items.map((it) => (
                      <tr key={it.id}>
	                        <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">{formatItemWithSpecification(it.item, it.specification)}</td>
                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{it.quantity}</td>
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

