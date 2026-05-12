import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { fetchGrnInvoiceLinkSummary, updateInvoicePayment, type GrnInvoiceLinkSummaryRow } from '@/src/lib/purchaseRequests';
import { fetchQueuePayment, type PaymentQueueRow, type QueueFilters } from '@/src/lib/queues';
import { formatItemInline } from '@/src/lib/itemLabel';
import { formatPoNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function PaymentQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true });
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<PaymentQueueRow[]>([]);
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
    fetchQueuePayment(filters, ac.signal)
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
  const [active, setActive] = useState<PaymentQueueRow | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [paymentStatus, setPaymentStatus] = useState<'' | 'Partly Paid' | 'Full Paid'>('');
  const [lines, setLines] = useState<GrnInvoiceLinkSummaryRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setPaymentDate(todayIsoDate());
    setPaymentStatus('');
    setLines([]);
    setModalLoading(false);
    setSaving(false);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    setPaymentDate(active.paymentDate ? String(active.paymentDate).slice(0, 10) : todayIsoDate());
    setPaymentStatus((active.paymentStatus as any) || '');
    const ac = new AbortController();
    setModalLoading(true);
    fetchGrnInvoiceLinkSummary(active.invoiceId, ac.signal)
      .then(setLines)
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

      {loading ? (
        <LoadingCard label="Loading invoices pending payment..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Pending Payment" subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1340px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[140px]" />
                <col className="w-[150px]" />
                <col className="w-[210px]" />
                <col className="w-[220px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
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
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Paid</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Remaining</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <tr key={r.invoiceId}>
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.invoiceNo ?? r.invoiceId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.invoiceDate ? formatDateDDMMYYYYOnly(r.invoiceDate) : '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.paidAmount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.remainingAmount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
                            View PR
                          </button>
                          <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setModalOpen(true); }}>
                            Payment
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={9}>
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
        title={`Invoice Due for Payment (1)`}
        titleCentered
        onClose={() => (saving ? null : closeModal())}
        fullScreen
        maxWidthClass="max-w-7xl"
        footer={
          <>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || modalLoading || !active || !paymentStatus || !paymentDate}
              onClick={() => {
                if (!active) return;
                setSaving(true);
                setModalError(null);
                updateInvoicePayment(active.invoiceId, { paymentStatus, paymentDate, updatedBy: 'Accounts Team' })
                  .then(() => fetchQueuePayment(filters).then(setRows))
                  .then(() => closeModal())
                  .catch((e) => setModalError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        {modalError ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">{modalError}</div> : null}

        {modalLoading ? (
          <div className="text-sm text-on-surface-variant">Loading invoice lines...</div>
        ) : (
	          <div className="overflow-x-auto">
	            <table className="w-full min-w-[1220px] table-fixed text-left border-collapse border border-outline-variant">
	              <colgroup>
	                <col className="w-[130px]" />
	                <col className="w-[130px]" />
	                <col className="w-[130px]" />
	                <col className="w-[120px]" />
	                <col className="w-[120px]" />
	                <col className="w-[150px]" />
	                <col className="w-[150px]" />
	                <col className="w-[420px]" />
	                <col className="w-[90px]" />
	                <col className="w-[90px]" />
	              </colgroup>
	              <thead>
	                <tr className="bg-primary text-on-primary">
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Invoice No</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Invoice Date</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Amount</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Status</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Payment Status</th>
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Payment Date</th>
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Inv Qty</th>
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">GRN Qty</th>
	                </tr>
	              </thead>
	              <tbody>
                {active && lines.length ? (
                  lines.map((l, idx) => (
                    <tr key={l.invoiceItemId}>
                      {idx === 0 ? (
                        <>
	                          <td className="px-3 py-2 text-sm border border-outline-variant" rowSpan={lines.length}>
	                            {formatPoNumber(active.poNumber ?? active.poId) || '-'}
	                          </td>
                          <td className="px-3 py-2 text-sm border border-outline-variant" rowSpan={lines.length}>
                            {active.invoiceNo ?? active.invoiceId}
                          </td>
                          <td className="px-3 py-2 text-sm border border-outline-variant" rowSpan={lines.length}>
                            {active.invoiceDate ? formatDateDDMMYYYYOnly(active.invoiceDate) : '-'}
                          </td>
                          <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums" rowSpan={lines.length}>
                            {Number(active.invoiceAmount ?? 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-sm border border-outline-variant" rowSpan={lines.length}>
                            {active.status ?? '-'}
                          </td>
                          <td className="px-3 py-2 border border-outline-variant" rowSpan={lines.length}>
                            <select className={cn(inputClass, 'py-1.5')} value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as any)}>
                              <option value="">Select</option>
                              <option value="Partly Paid">Partly Paid</option>
                              <option value="Full Paid">Full Paid</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 border border-outline-variant" rowSpan={lines.length}>
                            <input className={cn(inputClass, 'py-1.5')} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                          </td>
                        </>
	                      ) : null}
		                      <td className="px-3 py-2 text-sm border border-outline-variant">{formatItemInline(l.item, l.specificationsJson, specNameById)}</td>
		                      <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{l.invoiceQty}</td>
		                      <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{l.linkedQty}</td>
		                    </tr>
		                  ))
	                ) : (
	                  <tr>
	                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={10}>
	                      No records.
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
