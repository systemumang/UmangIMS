import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { fetchGrnInvoiceLinkSummary, updateInvoicePayment, type GrnInvoiceLinkSummaryRow } from '@/src/lib/purchaseRequests';
import { fetchQueuePayment, updateQueueTallyEntry, type PaymentQueueRow, type QueueFilters } from '@/src/lib/queues';
import { fetchOperationsInvoiceDetail } from '@/src/lib/operations';
import { formatItemInline } from '@/src/lib/itemLabel';
import { formatPoNumber } from '@/src/lib/docNumbers';
import { cn } from '@/src/lib/utils';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { ExportCsvButton, inputClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';
import Pagination from '@/src/components/common/Pagination';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function PaymentQueueView({
  onViewPr,
  queueLabel = 'Pending Payment',
  queuePathLabel = 'Pending Tasks / Pending Payment',
  exportPrefix = 'queue-payment',
  fetchRows = fetchQueuePayment,
  mode = 'payment',
}: {
  onViewPr: (prId: string) => void;
  queueLabel?: string;
  queuePathLabel?: string;
  exportPrefix?: string;
  fetchRows?: (filters?: QueueFilters, signal?: AbortSignal) => Promise<PaymentQueueRow[]>;
  mode?: 'payment' | 'tally';
}) {
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
    fetchRows(filters, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [fetchRows, filters]);

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
  const [paymentModeInput, setPaymentModeInput] = useState('Cash');
  const [tallyEntryDate, setTallyEntryDate] = useState('');
  const [lines, setLines] = useState<GrnInvoiceLinkSummaryRow[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [tallyDateInput, setTallyDateInput] = useState('');
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<GrnInvoiceLinkSummaryRow[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setPaymentDate(todayIsoDate());
    setPaymentStatus('');
    setPaymentModeInput('Cash');
    setTallyEntryDate('');
    setTallyDateInput('');
    setLines([]);
    setModalLoading(false);
    setSaving(false);
    setModalError(null);
    setInvoiceDetail(null);
    setInvoiceDetailLoading(false);
  }

  useEffect(() => {
    if (mode !== 'tally') return;
    if (!expandedInvoiceId) {
      setExpandedLines([]);
      return;
    }
    const ac = new AbortController();
    setExpandedLoading(true);
    fetchGrnInvoiceLinkSummary(expandedInvoiceId, ac.signal)
      .then(setExpandedLines)
      .catch(() => setExpandedLines([]))
      .finally(() => setExpandedLoading(false));
    return () => ac.abort();
  }, [expandedInvoiceId, mode]);

  useEffect(() => {
    if (!modalOpen || !active) return;
    setPaymentDate(active.paymentDate ? String(active.paymentDate).slice(0, 10) : todayIsoDate());
    setPaymentStatus((active.paymentStatus as any) || '');
    setPaymentModeInput(String((active as any)?.paymentMode ?? 'Cash') || 'Cash');
    setTallyEntryDate(active.tallyEntryDate ? String(active.tallyEntryDate).slice(0, 10) : '');
    setTallyDateInput(active.tallyEntryDate ? String(active.tallyEntryDate).slice(0, 10) : todayIsoDate());
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

  useEffect(() => {
    if (!modalOpen || !active || mode !== 'tally') return;
    const ac = new AbortController();
    setInvoiceDetailLoading(true);
    setInvoiceDetail(null);
    fetchOperationsInvoiceDetail(active.invoiceId, ac.signal)
      .then((d) => setInvoiceDetail(d))
      .catch(() => setInvoiceDetail(null))
      .finally(() => setInvoiceDetailLoading(false));
    return () => ac.abort();
  }, [active, modalOpen, mode]);

	  return (
	    <div className="space-y-6">
	      {masters.error ? <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load masters: {masters.error}</div> : null}
	      <div className="hidden">
		        <div className="text-sm text-on-surface-variant">{queuePathLabel}</div>
		        <ExportCsvButton id="pending-export-btn" filename={`${exportPrefix}-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
	      </div>
	      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

	      {loading ? (
        <LoadingCard label="Loading invoices pending payment..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
	        <QueueCard title={queueLabel} subtitle={`${rows.length} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1340px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[140px]" />
                <col className="w-[150px]" />
                <col className="w-[210px]" />
                <col className="w-[220px]" />
		                <col className="w-[140px]" />
		                  {mode !== 'tally' ? <col className="w-[120px]" /> : null}
	                  {mode !== 'tally' ? <col className="w-[130px]" /> : null}
		                {mode !== 'tally' ? <col className="w-[140px]" /> : null}
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
		                    <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Tally Date</th>
		                  {mode !== 'tally' ? <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Paid</th> : null}
	                  {mode !== 'tally' ? <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Remaining</th> : null}
	                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((r) => (
                    <React.Fragment key={r.invoiceId}>
                    <tr
                      className={mode === 'tally' ? 'cursor-pointer hover:bg-surface-container-low/50' : ''}
                      onClick={() => {
                        if (mode !== 'tally') return;
                        setExpandedInvoiceId((prev) => (prev === r.invoiceId ? null : r.invoiceId));
                      }}
                    >
                      <td className="px-3 py-2 text-sm text-primary font-semibold border border-outline-variant">{r.invoiceNo ?? r.invoiceId}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.invoiceDate ? formatDateDDMMYYYYOnly(r.invoiceDate) : '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{formatPoNumber(r.poNumber ?? r.poId) || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.firmName}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.supplierName || '-'}</td>
		                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(2)}</td>
	                        <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.tallyEntryDate ? formatDateDDMMYYYYOnly(r.tallyEntryDate) : '-'}</td>
		                      {mode !== 'tally' ? <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.paidAmount ?? 0).toFixed(2)}</td> : null}
                      {mode !== 'tally' ? <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.remainingAmount ?? 0).toFixed(2)}</td> : null}
                      <td className="px-3 py-2 border border-outline-variant">
	                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
	                          <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setModalOpen(true); }}>
                            {mode === 'tally' ? 'Update Tally' : 'Payment'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {mode === 'tally' && expandedInvoiceId === r.invoiceId ? (
                      <tr>
                        <td className="px-3 py-3 border border-outline-variant bg-surface-container-low" colSpan={8}>
                          {expandedLoading ? (
                            <div className="text-sm text-on-surface-variant">Loading invoice items...</div>
                          ) : expandedLines.length ? (
                            <table className="w-full text-left border-collapse text-sm">
                              <thead className="bg-primary text-on-primary">
                                <tr>
                                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
                                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Inv Qty</th>
                                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">GRN Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedLines.map((l) => (
                                  <tr key={l.invoiceItemId}>
                                    <td className="px-3 py-2 border border-outline-variant">{formatItemInline(l.item, l.specificationsJson, specNameById)}</td>
                                    <td className="px-3 py-2 border border-outline-variant tabular-nums">{l.invoiceQty}</td>
                                    <td className="px-3 py-2 border border-outline-variant tabular-nums">{l.linkedQty}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="text-sm text-on-surface-variant">No invoice items found.</div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  ))
                ) : (
                  <tr>
			                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={mode === 'tally' ? 8 : 10}>
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
        title={mode === 'tally' ? `Tally Entry Update` : `Invoice Due for Payment (1)`}
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
              disabled={saving || modalLoading || !active || (mode === 'payment' ? (!paymentStatus || !paymentDate) : !tallyDateInput)}
              onClick={() => {
                if (!active) return;
                setSaving(true);
                setModalError(null);
                const savePromise =
                  mode === 'tally'
                    ? updateQueueTallyEntry(active.invoiceId, { tallyEntryDate: tallyDateInput, updatedBy: 'Accounts Team' })
                    : updateInvoicePayment(active.invoiceId, {
                        paymentStatus,
                        paymentDate,
                        paymentMode: paymentModeInput || undefined,
                        updatedBy: 'Accounts Team',
                        tallyEntryDate: tallyEntryDate || undefined,
                      });
                savePromise
                  .then(() => fetchRows(filters).then(setRows))
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

        {mode === 'tally' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
              <div><span className="font-semibold">Invoice:</span> {active?.invoiceNo ?? '-'}</div>
              <div><span className="font-semibold">PO:</span> {formatPoNumber(active?.poNumber ?? active?.poId) || '-'}</div>
              <div><span className="font-semibold">Date:</span> {active?.invoiceDate ? formatDateDDMMYYYYOnly(active.invoiceDate) : '-'}</div>
              <div><span className="font-semibold">Supplier:</span> {active?.supplierName || '-'}</div>
              <div><span className="font-semibold">Amount:</span> {Number(active?.invoiceAmount ?? 0).toFixed(2)}</div>
              <div><span className="font-semibold">Payment Mode:</span> {String(invoiceDetail?.invoice?.invoice?.paymentMode ?? active?.paymentMode ?? 'Credit')}</div>
              <div><span className="font-semibold">Payment Status:</span> {String(invoiceDetail?.invoice?.invoice?.paymentStatus ?? '-')}</div>
              <div><span className="font-semibold">E-way Bill No:</span> {String(invoiceDetail?.invoice?.invoice?.ewayBillNumber ?? '-')}</div>
              <div><span className="font-semibold">CN/Courier No:</span> {String(invoiceDetail?.invoice?.invoice?.cnNumber ?? invoiceDetail?.invoice?.invoice?.courierNumber ?? '-')}</div>
              <div><span className="font-semibold">Transporter:</span> {String(invoiceDetail?.invoice?.invoice?.transporterName ?? '-')}</div>
              <div><span className="font-semibold">Courier Charge:</span> {Number(invoiceDetail?.invoice?.invoice?.courierCharge ?? 0).toFixed(2)}</div>
              <div><span className="font-semibold">Packing Charge:</span> {Number(invoiceDetail?.invoice?.invoice?.packingCharge ?? 0).toFixed(2)}</div>
              <div><span className="font-semibold">Labour Charge:</span> {Number(invoiceDetail?.invoice?.invoice?.labourCharge ?? 0).toFixed(2)}</div>
              <div><span className="font-semibold">Other Charge:</span> {Number(invoiceDetail?.invoice?.invoice?.otherCharge ?? 0).toFixed(2)}</div>
              <div><span className="font-semibold">GST On Charges:</span> {Number(invoiceDetail?.invoice?.invoice?.chargesGstAmount ?? 0).toFixed(2)}</div>
              <div>
                <span className="font-semibold">Invoice PDF:</span>{' '}
                {invoiceDetail?.invoice?.invoice?.documentUrl ? (
                  <a href={String(invoiceDetail.invoice.invoice.documentUrl)} target="_blank" rel="noreferrer" className="text-primary underline">View PDF</a>
                ) : '-'}
              </div>
            </div>
            <label className="space-y-1 block max-w-md">
              <div className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Tally Entry Date</div>
              <input className={cn(inputClass, 'py-1.5')} type="date" value={tallyDateInput} onChange={(e) => setTallyDateInput(e.target.value)} />
            </label>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] table-fixed text-left border-collapse border border-outline-variant">
                <colgroup>
                  <col className="w-[420px]" />
                  <col className="w-[140px]" />
                  <col className="w-[140px]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-on-primary">
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Invoice Qty</th>
                    <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Link Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceDetailLoading ? (
                    <tr>
                      <td className="px-3 py-3 text-sm text-on-surface-variant border border-outline-variant" colSpan={3}>Loading invoice details...</td>
                    </tr>
                  ) : (invoiceDetail?.invoice?.items?.length ?? 0) > 0 ? (
                    (invoiceDetail.invoice.items as any[]).map((it: any, idx: number) => (
                      <tr key={String(it.id ?? idx)}>
                        <td className="px-3 py-2 text-sm border border-outline-variant">{formatItemInline(it.item, it.specificationsJson, specNameById)}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">{Number(it.quantity ?? 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-sm border border-outline-variant tabular-nums">
                          {Number(lines.find((x) => String(x.itemId) === String(it.itemId))?.linkedQty ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-sm text-on-surface-variant border border-outline-variant" colSpan={3}>No invoice items found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : modalLoading ? (
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
			                <col className="w-[160px]" />
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
                      <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Payment Mode</th>
	                      <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Tally Date</th>
		                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Item</th>
	                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Inv Qty</th>
		                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest border border-outline-variant">Link Qty</th>
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
                              <td className="px-3 py-2 border border-outline-variant" rowSpan={lines.length}>
                                <select className={cn(inputClass, 'py-1.5')} value={paymentModeInput} onChange={(e) => setPaymentModeInput(e.target.value)}>
                                  <option value="Cash">Cash</option>
                                  <option value="UPI">UPI</option>
                                  <option value="Cheque">Cheque</option>
                                  <option value="NEFT">NEFT</option>
                                  <option value="RTGS">RTGS</option>
                                  <option value="IMPS">IMPS</option>
                                  <option value="Card">Card</option>
                                </select>
                              </td>
                            <td className="px-3 py-2 border border-outline-variant" rowSpan={lines.length}>
                              <input className={cn(inputClass, 'py-1.5')} type="date" value={tallyEntryDate} onChange={(e) => setTallyEntryDate(e.target.value)} />
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
			                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={12}>
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
