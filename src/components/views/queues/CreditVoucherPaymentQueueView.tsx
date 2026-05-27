import React, { useEffect, useMemo, useState } from 'react';
import Pagination from '@/src/components/common/Pagination';
import { formatPrNumber, formatPoNumber } from '@/src/lib/docNumbers';
import { updateCreditVoucherPayment } from '@/src/lib/purchaseRequests';
import { fetchQueueCreditVoucherPayment, type CreditVoucherPaymentQueueRow, type QueueFilters } from '@/src/lib/queues';
import { inputClass, labelClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters, ExportCsvButton } from './shared';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function CreditVoucherPaymentQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<CreditVoucherPaymentQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [filters]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueCreditVoucherPayment(filters, ac.signal)
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
    return rows.slice(start, start + pageSize);
  }, [page, rows]);

  const [modalOpen, setModalOpen] = useState(false);
  const [active, setActive] = useState<CreditVoucherPaymentQueueRow | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentModeInput, setPaymentModeInput] = useState('Cash');
  const [paymentCopyInput, setPaymentCopyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setPaymentDate(todayIsoDate());
    setPaymentAmountInput('');
    setPaymentModeInput('Cash');
    setPaymentCopyInput('');
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    setPaymentDate(todayIsoDate());
    setPaymentAmountInput(String(Number(active.remainingAmount ?? 0).toFixed(2)));
    setPaymentModeInput('Cash');
  }, [active, modalOpen]);

  const canSave = useMemo(() => {
    if (!active) return false;
    if (!paymentDate) return false;
    const amt = Number(paymentAmountInput);
    if (!Number.isFinite(amt) || amt < 0) return false;
    if (amt - Number(active.remainingAmount ?? 0) > 1e-9) return false;
    if (!String(paymentModeInput ?? '').trim()) return false;
    return true;
  }, [active, paymentAmountInput, paymentDate, paymentModeInput]);

  async function save() {
    if (!active || !canSave) return;
    setSaving(true);
    setModalError(null);
    try {
      await updateCreditVoucherPayment(active.creditVoucherId, {
        paymentDate,
        paymentAmount: Number(paymentAmountInput || 0),
        paymentMode: paymentModeInput,
        paymentCopy: paymentCopyInput.trim() || undefined,
        updatedBy: 'system',
      });
      closeModal();
      const refreshed = await fetchQueueCreditVoucherPayment(filters);
      setRows(refreshed);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <QueueCard title="Pending Credit Voucher Payment">
      <QueueFiltersBar masters={masters} filters={filters} onChange={setFilters} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-on-surface-variant">Showing: {rows.length}</div>
        <ExportCsvButton
          id="pending-export-btn"
          filename={`queue-credit-voucher-payment-${new Date().toISOString().slice(0, 10)}.csv`}
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
              <th className="px-3 py-2 border border-outline-variant text-right">Paid</th>
              <th className="px-3 py-2 border border-outline-variant text-right">Balance</th>
              <th className="px-3 py-2 border border-outline-variant">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length ? (
              pagedRows.map((r) => (
                <tr key={r.creditVoucherId} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{r.voucherNo}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.voucherDate}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{formatPoNumber((r as any).poNumber ?? r.poId) || r.poId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{formatPrNumber((r as any).prNumber ?? r.prId) || r.prId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.supplierName}</td>
                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(r.voucherAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(r.paidAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(r.remainingAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 border border-outline-variant">
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setModalOpen(true); }}>
                        Payment
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => onViewPr(r.prId)}>
                        View PR
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-6 border border-outline-variant text-on-surface-variant text-center" colSpan={9}>
                  No pending payments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} />

      <Modal
        open={modalOpen}
        title="Credit Voucher Payment"
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!canSave || saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        {modalError ? <div className="p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm">{modalError}</div> : null}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <div className={labelClass}>Payment Date</div>
            <input className={inputClass} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </label>
          <label className="space-y-1">
            <div className={labelClass}>Amount</div>
            <input className={inputClass} value={paymentAmountInput} onChange={(e) => setPaymentAmountInput(e.target.value)} placeholder="0" />
          </label>
          <label className="space-y-1">
            <div className={labelClass}>Mode</div>
            <input className={inputClass} value={paymentModeInput} onChange={(e) => setPaymentModeInput(e.target.value)} placeholder="Cash/NEFT/..." />
          </label>
          <label className="space-y-1 md:col-span-3">
            <div className={labelClass}>Payment Copy/Ref (optional)</div>
            <input className={inputClass} value={paymentCopyInput} onChange={(e) => setPaymentCopyInput(e.target.value)} placeholder="Ref no / URL" />
          </label>
        </div>
      </Modal>
    </QueueCard>
  );
}

