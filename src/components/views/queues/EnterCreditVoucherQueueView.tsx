import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { formatPrNumber, formatPoNumber } from '@/src/lib/docNumbers';
import { createCreditVoucher, fetchPendingInvoiceItems, fetchWorkflow } from '@/src/lib/purchaseRequests';
import { fetchQueueEnterCreditVoucher, type EnterCreditVoucherQueueRow, type QueueFilters } from '@/src/lib/queues';
import { cn } from '@/src/lib/utils';
import Pagination from '@/src/components/common/Pagination';
import {
  ExportCsvButton,
  inputClass,
  labelClass,
  LoadingCard,
  Modal,
  QueueCard,
  QueueFiltersBar,
  useQueueMasters,
} from './shared';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type PendingItem = { itemId: string; item: string; pendingQty: number; rate: number };
type Line = { itemId: string; item: string; pendingQty: number; quantity: string; rate: string };

export default function EnterCreditVoucherQueueView({ onViewPr }: { onViewPr: (prId: string) => void }) {
  const masters = useQueueMasters({ includeSuppliers: true, includeUsers: true });
  const [filters, setFilters] = useState<QueueFilters>({ q: '', firmId: '', department: '', projectId: '', supplierId: '', from: '', to: '' });
  const [rows, setRows] = useState<EnterCreditVoucherQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [filters]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchQueueEnterCreditVoucher(filters, ac.signal)
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
  const [active, setActive] = useState<EnterCreditVoucherQueueRow | null>(null);
  const [voucherDate, setVoucherDate] = useState(todayIsoDate());
  const [lines, setLines] = useState<Line[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function closeModal() {
    setModalOpen(false);
    setActive(null);
    setVoucherDate(todayIsoDate());
    setLines([]);
    setModalError(null);
  }

  useEffect(() => {
    if (!modalOpen || !active) return;
    const ac = new AbortController();
    setModalLoading(true);
    setModalError(null);
    Promise.all([fetchPendingInvoiceItems(active.poId, ac.signal), fetchWorkflow(active.prId, ac.signal, active.poId)])
      .then(([items]) => {
        const next: Line[] = (items as PendingItem[]).map((it) => ({
          itemId: it.itemId,
          item: it.item,
          pendingQty: Number(it.pendingQty ?? 0),
          quantity: String(it.pendingQty ?? 0),
          rate: String(it.rate ?? 0),
        }));
        setLines(next.filter((l) => Number(l.pendingQty) > 0));
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setModalError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setModalLoading(false));
    return () => ac.abort();
  }, [active, modalOpen]);

  const canSave = useMemo(() => {
    if (!active) return false;
    if (!voucherDate) return false;
    const validLines = lines
      .map((l) => ({ ...l, q: Number(l.quantity), r: Number(l.rate) }))
      .filter((l) => l.itemId && Number.isFinite(l.q) && l.q > 0 && Number.isFinite(l.r) && l.r >= 0);
    if (!validLines.length) return false;
    if (validLines.some((l) => l.q > l.pendingQty + 1e-9)) return false;
    return true;
  }, [active, lines, voucherDate]);

  async function save() {
    if (!active || !canSave) return;
    setSaving(true);
    setModalError(null);
    try {
      const picked = lines
        .map((l) => ({ ...l, quantityNum: Number(l.quantity), rateNum: Number(l.rate) }))
        .filter((l) => l.itemId && Number.isFinite(l.quantityNum) && l.quantityNum > 0)
        .map((l) => ({ itemId: l.itemId, quantity: l.quantityNum, rate: Number.isFinite(l.rateNum) ? l.rateNum : 0 }));
      await createCreditVoucher(active.poId, {
        voucherNumber: null,
        voucherDate,
        updatedBy: 'system',
        items: picked,
      });
      closeModal();
      const refreshed = await fetchQueueEnterCreditVoucher(filters);
      setRows(refreshed);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <QueueCard title="Enter Credit Voucher">
      <QueueFiltersBar masters={masters} filters={filters} onChange={setFilters} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-on-surface-variant">Showing: {rows.length}</div>
        <ExportCsvButton id="pending-export-btn" filename={`queue-enter-credit-voucher-${new Date().toISOString().slice(0, 10)}.csv`} rows={rows} disabled={loading} />
      </div>
      {loading ? <LoadingCard label="Loading..." /> : null}
      {error ? <div className="p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm">{error}</div> : null}

      <div className="overflow-auto rounded-xl border border-outline-variant">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
            <tr>
              <th className="px-3 py-2 border border-outline-variant">PO</th>
              <th className="px-3 py-2 border border-outline-variant">PR</th>
              <th className="px-3 py-2 border border-outline-variant">Firm</th>
              <th className="px-3 py-2 border border-outline-variant">Supplier</th>
              <th className="px-3 py-2 border border-outline-variant">Reason</th>
              <th className="px-3 py-2 border border-outline-variant">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length ? (
              pagedRows.map((r) => (
                <tr key={r.poId} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-3 py-2 border border-outline-variant text-primary font-semibold">{formatPoNumber((r as any).poNumber ?? r.poId) || r.poId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{formatPrNumber((r as any).prNumber ?? r.prId) || r.prId}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.firmName}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.supplierName}</td>
                  <td className="px-3 py-2 border border-outline-variant text-on-surface-variant">{r.pendingReason}</td>
                  <td className="px-3 py-2 border border-outline-variant">
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { setActive(r); setModalOpen(true); }}>
                        Create
                      </button>
                      <a
                        href={`/api/pos/${encodeURIComponent(String(r.poId ?? ''))}.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant"
                        title="Download PO PDF"
                        aria-label="Download PO PDF"
                      >
                        <Download size={16} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-6 border border-outline-variant text-on-surface-variant text-center" colSpan={6}>
                  No pending credit vouchers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} />

      <Modal
        open={modalOpen}
        title="Create Credit Voucher"
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
            <div className={labelClass}>Voucher Date</div>
            <input className={inputClass} type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className={labelClass}>Voucher No (auto)</div>
            <input className={inputClass} value="Auto-generated by system" readOnly />
          </label>
        </div>

        {modalLoading ? <LoadingCard label="Loading PO items..." /> : null}

        {lines.length ? (
          <div className="overflow-auto rounded-xl border border-outline-variant">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                <tr>
                  <th className="px-3 py-2 border border-outline-variant">Item</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Max Qty</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Qty</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Rate</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, idx) => (
                  <tr key={ln.itemId} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="px-3 py-2 border border-outline-variant">{ln.item}</td>
                    <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">{Number(ln.pendingQty ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2 border border-outline-variant">
                      <input
                        className={cn(inputClass, 'h-9 text-right')}
                        value={ln.quantity}
                        onChange={(e) =>
                          setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p)))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2 border border-outline-variant">
                      <input
                        className={cn(inputClass, 'h-9 text-right')}
                        value={ln.rate}
                        readOnly
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2 border border-outline-variant text-right tabular-nums">
                      {(Number(ln.quantity || 0) * Number(ln.rate || 0)).toFixed(2)}
                    </td>
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
