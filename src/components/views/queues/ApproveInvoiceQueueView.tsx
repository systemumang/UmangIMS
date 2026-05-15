import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { fetchQueueApproveInvoice, updateQueueApproveInvoice, type ApproveInvoiceQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatPoNumber } from '@/src/lib/docNumbers';
import { ExportCsvButton, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';

export default function ApproveInvoiceQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<ApproveInvoiceQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mastersForFilters = useMemo(
    () => ({ firms: masters.firms, departments: masters.departments, projects: masters.projects, suppliers: masters.suppliers }),
    [masters.departments, masters.firms, masters.projects, masters.suppliers]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueApproveInvoice(filters, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [filters]);

  const [modalOpen, setModalOpen] = useState(false);
  const [active, setActive] = useState<ApproveInvoiceQueueRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState('');
  const [approveDate, setApproveDate] = useState(() => new Date().toISOString().slice(0, 10));

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setSaving(false);
    setModalError(null);
    setApprovedBy('');
    setApproveDate(new Date().toISOString().slice(0, 10));
  }

  useEffect(() => {
    if (!modalOpen) return;
    if (approvedBy) return;
    if (masters.loading) return;
    if (masters.users.length) setApprovedBy(String(masters.users[0]?.name ?? ''));
  }, [approvedBy, masters.loading, masters.users, modalOpen]);

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
	        <div className="text-sm text-on-surface-variant">Pending Tasks / Approve Invoice</div>
	        <ExportCsvButton id="pending-export-btn" filename={`queue-approve-invoice-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
	        <LoadingCard label="Loading invoices awaiting approval..." />
	      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Approve Invoice" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[190px]" />
                <col className="w-[210px]" />
                <col className="w-[140px]" />
                <col className="w-[160px]" />
                <col className="w-[260px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Invoice</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Date</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Amount</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Status</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.invoiceId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.invoiceNo ?? r.invoiceId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.invoiceDate ? formatDateDDMMYYYYOnly(r.invoiceDate) : '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.status}</td>
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
                              setModalError(null);
                              setModalOpen(true);
                            }}
                          >
                            Approve
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
        </QueueCard>
      )}

      <Modal
        open={modalOpen}
        title={`Approve Invoice ${active?.invoiceNo ?? active?.invoiceId ?? ''}`}
        onClose={() => (saving ? null : closeModal())}
        maxWidthClass="max-w-3xl"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || !active || !approvedBy.trim() || !approveDate}
              onClick={() => {
                if (!active) return;
                setSaving(true);
                setModalError(null);
                updateQueueApproveInvoice(active.invoiceId, { approvedBy: approvedBy.trim(), approveDate })
                  .then(() => fetchQueueApproveInvoice(filters).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Approve'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Approved By</div>
            <input
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              placeholder="Enter approver name"
            />
          </label>
          <label className="space-y-1">
            <div className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Approve Date</div>
            <input
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant"
              type="date"
              value={approveDate}
              onChange={(e) => setApproveDate(e.target.value)}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
