import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import { formatPrNumber, formatPoNumber } from '@/src/lib/docNumbers';
import { updateCreditVoucherPayment } from '@/src/lib/purchaseRequests';
import { uploadFileToServer } from '@/src/lib/uploads';
import { fetchQueueCreditVoucherPayment, type CreditVoucherPaymentQueueRow, type QueueFilters } from '@/src/lib/queues';
import { inputClass, labelClass, LoadingCard, Modal, QueueCard, QueueFiltersBar, useQueueMasters, ExportCsvButton } from './shared';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function CreditVoucherPaymentQueueView({ onViewPr: _onViewPr }: { onViewPr: (prId: string) => void }) {
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
  const [paymentCopyUploading, setPaymentCopyUploading] = useState(false);
  const [voucherItems, setVoucherItems] = useState<Array<{ itemName: string; quantity: number; rate: number; amount: number }>>([]);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setPaymentDate(todayIsoDate());
    setPaymentAmountInput('');
    setPaymentModeInput('Cash');
    setPaymentCopyInput('');
    setVoucherItems([]);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    setPaymentDate(todayIsoDate());
    setPaymentAmountInput(String(Number(active.remainingAmount ?? 0).toFixed(2)));
    setPaymentModeInput('Cash');
    const ac = new AbortController();
    fetch(`/api/credit-vouchers/${encodeURIComponent(String(active.creditVoucherId ?? ''))}/items`, { signal: ac.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data as any)?.error ? String((data as any).error) : 'Failed to load voucher items');
        const rows = Array.isArray((data as any)?.items) ? (data as any).items : [];
        setVoucherItems(
          rows.map((r: any) => ({
            itemName: String(r.itemName ?? ''),
            quantity: Number(r.quantity ?? 0),
            rate: Number(r.rate ?? 0),
            amount: Number(r.amount ?? 0),
          }))
        );
      })
      .catch(() => setVoucherItems([]));
    return () => ac.abort();
  }, [active, modalOpen]);

  const canSave = useMemo(() => {
    if (!active) return false;
    if (!paymentDate) return false;
    const amt = Number(paymentAmountInput);
    if (!Number.isFinite(amt) || amt < 0) return false;
    if (amt - Number(active.remainingAmount ?? 0) > 1e-9) return false;
    if (!String(paymentModeInput ?? '').trim()) return false;
    if (!String(paymentCopyInput ?? '').trim()) return false;
    return true;
  }, [active, paymentAmountInput, paymentDate, paymentModeInput, paymentCopyInput]);

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
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!canSave || saving || paymentCopyUploading}>
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
            <select className={inputClass} value={paymentModeInput} onChange={(e) => setPaymentModeInput(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Cheque">Cheque</option>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="IMPS">IMPS</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label className="space-y-1 md:col-span-3">
            <div className={labelClass}>Payment Copy <span className="text-red-600">*</span></div>
            <input className={inputClass} value={paymentCopyInput} onChange={(e) => setPaymentCopyInput(e.target.value)} placeholder="Ref no / URL / file link" />
            <div className="pt-1">
              <label className={`btn btn-sm cursor-pointer ${paymentCopyUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                {paymentCopyUploading ? 'Uploading...' : paymentCopyInput.trim() ? 'Uploaded' : 'Upload'}
                <input
                  type="file"
                  className="hidden"
                  disabled={saving || paymentCopyUploading}
                  onChange={async (e) => {
                    const inputEl = e.currentTarget;
                    const file = inputEl.files?.[0];
                    if (!file) return;
                    try {
                      setPaymentCopyUploading(true);
                      const { url } = await uploadFileToServer(file);
                      setPaymentCopyInput(url);
                    } catch (err) {
                      setModalError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setPaymentCopyUploading(false);
                      if (inputEl?.isConnected) inputEl.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </label>
        </div>
        {voucherItems.length ? (
          <div className="mt-3 overflow-auto rounded-xl border border-outline-variant">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                <tr>
                  <th className="px-3 py-2 border border-outline-variant">Service Name</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Qty</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Rate</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {voucherItems.map((it, idx) => (
                  <tr key={`${it.itemName}-${idx}`}>
                    <td className="px-3 py-2 border border-outline-variant">{it.itemName || '-'}</td>
                    <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.quantity ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.rate ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(it.amount ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </QueueCard>
  );
}
