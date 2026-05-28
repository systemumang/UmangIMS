import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import { formatPrNumber, formatPoNumber } from '@/src/lib/docNumbers';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { fetchQueueApproveCreditVoucher, updateQueueApproveCreditVoucher, type ApproveCreditVoucherQueueRow, type QueueFilters } from '@/src/lib/queues';
import { inputClass, labelClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters, ExportCsvButton } from './shared';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ApproveCreditVoucherQueueView({ onViewPr: _onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rows, setRows] = useState<ApproveCreditVoucherQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setSelectedRowId(null);
  }, [filters]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueApproveCreditVoucher(filters, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [filters]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    const slice = rows.slice(start, start + pageSize);
    if (selectedRowId) {
      return slice.filter((r) => r.creditVoucherId === selectedRowId);
    }
    return slice;
  }, [page, rows, selectedRowId]);

  const [modalOpen, setModalOpen] = useState(false);
  const [active, setActive] = useState<ApproveCreditVoucherQueueRow | null>(null);
  const [approvedBy, setApprovedBy] = useState('');
  const [approveDate, setApproveDate] = useState(todayIsoDate());
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen) return;
    if (approvedBy) return;
    if (masters.loading) return;
    const first = masters.users?.[0]?.id ?? '';
    if (first) setApprovedBy(first);
  }, [approvedBy, masters.loading, masters.users, modalOpen]);

  const canApprove = Boolean(active && approvedBy.trim() && approveDate);

  async function approve() {
    if (!active) return;
    const selectedUser = masters.users.find((u) => u.id === approvedBy);
    const approvedByName = String(selectedUser?.name ?? '').trim();
    if (!approvedByName) return;
    setSaving(true);
    setModalError(null);
    try {
      await updateQueueApproveCreditVoucher(active.creditVoucherId, { approvedBy: approvedByName, approveDate });
      closeModal();
      const refreshed = await fetchQueueApproveCreditVoucher(filters);
      setRows(refreshed);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <QueueCard title="Approve Credit Voucher">
      <QueueFiltersBar masters={masters} filters={filters} onChange={setFilters} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-on-surface-variant">Showing: {rows.length}</div>
        <ExportCsvButton
          id="pending-export-btn"
          filename={`queue-approve-credit-voucher-${new Date().toISOString().slice(0, 10)}.csv`}
          rows={rows}
          disabled={loading}
        />
      </div>
      {loading ? <LoadingCard label="Loading..." /> : null}
      {error ? <div className="p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm">{error}</div> : null}

      <div className="overflow-auto rounded-xl border border-outline-variant">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
            <tr>
              <th className="px-3 py-2 border border-outline-variant">Voucher</th>
              <th className="px-3 py-2 border border-outline-variant">Date</th>
              <th className="px-3 py-2 border border-outline-variant">PO</th>
              <th className="px-3 py-2 border border-outline-variant">PR</th>
              <th className="px-3 py-2 border border-outline-variant">Supplier</th>
              <th className="px-3 py-2 border border-outline-variant text-right">Amount</th>
              <th className="px-3 py-2 border border-outline-variant">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length ? (
              pagedRows.map((r) => (
                <tr
                  key={r.creditVoucherId}
                  className={cn('cursor-pointer hover:bg-surface-container-low/50 transition-colors', selectedRowId === r.creditVoucherId && 'bg-primary/10')}
                  onClick={() => setSelectedRowId(selectedRowId === r.creditVoucherId ? null : r.creditVoucherId)}
                >
                  <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{r.voucherNo}</td>
	                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.voucherDate ? formatDateDDMMYYYYOnly(r.voucherDate) : '-'}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{formatPoNumber((r as any).poNumber ?? r.poId) || r.poId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{formatPrNumber((r as any).prNumber ?? r.prId) || r.prId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.supplierName}</td>
                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(r.voucherAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 border border-outline-variant">
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setModalOpen(true); }}>
                        Approve
                      </button>
                      <a
                        href={`/api/credit-vouchers/${encodeURIComponent(String(r.creditVoucherId ?? ''))}.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant"
                        title="Download Credit Voucher PDF"
                        aria-label="Download Credit Voucher PDF"
                      >
                        <Download size={16} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-6 border border-outline-variant text-on-surface-variant text-center" colSpan={7}>
                  No pending approvals.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} />

      <Modal
        open={modalOpen}
        title="Approve Credit Voucher"
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={approve} disabled={!canApprove || saving}>
              {saving ? 'Approving...' : 'Approve'}
            </button>
          </>
        }
      >
        {modalError ? <div className="p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm">{modalError}</div> : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className={labelClass}>Approved By</div>
            <select className={inputClass} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}>
              {masters.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <div className={labelClass}>Approve Date</div>
            <input className={inputClass} type="date" value={approveDate} onChange={(e) => setApproveDate(e.target.value)} />
          </label>
        </div>
      </Modal>
    </QueueCard>
  );
}
