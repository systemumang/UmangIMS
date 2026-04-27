import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { approveInvoice } from '@/src/lib/purchaseRequests';
import { fetchQueueApproveInvoice, type ApproveInvoiceQueueRow, type QueueFilters } from '@/src/lib/queues';
import { LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';

export default function ApproveInvoiceQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true });
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
  const [result, setResult] = useState<{ status: string; mismatches: string[] } | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setSaving(false);
    setModalError(null);
    setResult(null);
  }

  return (
    <div className="space-y-6">
      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
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
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.poNumber ?? r.poId}</td>
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
                              setResult(null);
                              setModalError(null);
                              setModalOpen(true);
                            }}
                          >
                            Decide
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
        title={`Approve / Hold Invoice ${active?.invoiceNo ?? active?.invoiceId ?? ''}`}
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
              disabled={saving || !active}
              onClick={() => {
                if (!active) return;
                setSaving(true);
                setModalError(null);
                setResult(null);
                approveInvoice(active.invoiceId)
                  .then((r) => setResult({ status: String(r.status), mismatches: Array.isArray(r.mismatches) ? r.mismatches : [] }))
                  .then(() => fetchQueueApproveInvoice(filters).then(setRows))
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Processing...' : 'Run Approval'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}
        <div className="text-sm text-on-surface-variant">
          This will approve the invoice when there are no mismatches, otherwise it will put it on hold.
        </div>
        {result ? (
          <div className="bg-surface-container rounded-xl border border-outline-variant/10 p-4 space-y-2">
            <div className="text-sm text-on-surface">
              Result status: <span className="font-bold">{result.status}</span>
            </div>
            {result.mismatches.length ? (
              <div>
                <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Mismatches</div>
                <ul className="list-disc pl-5 text-sm text-on-surface-variant space-y-1">
                  {result.mismatches.map((m, idx) => (
                    <li key={idx}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-on-surface-variant">No mismatches.</div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
