import React, { useEffect, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';
import { fetchPendingOrderReport, type PendingOrderReportRow } from '@/src/lib/reports';

function qty(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value ?? 0));
}

export default function PendingOrderReportView() {
  const [rows, setRows] = useState<PendingOrderReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchPendingOrderReport(ac.signal)
      .then(setRows)
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-on-surface">Pending for Order</div>
        <div className="text-sm text-on-surface-variant">Showing: {rows.length}</div>
      </div>
      {loading ? (
        <div className="p-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="p-4 text-sm text-error">{error}</div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm border-collapse border border-black">
            <thead className="bg-primary text-on-primary text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left border border-black">Item</th>
                <th className="px-3 py-2 text-left border border-black">Category</th>
                <th className="px-3 py-2 text-right border border-black">Current Balance</th>
                <th className="px-3 py-2 text-right border border-black">PO In Progress</th>
                <th className="px-3 py-2 text-right border border-black">Re-Order Level</th>
                <th className="px-3 py-2 text-right border border-black">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.itemId} className="bg-red-50/60">
                  <td className="px-3 py-2 border border-black font-semibold">{row.item || '-'}</td>
                  <td className="px-3 py-2 border border-black">{row.category || '-'}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.currentBalance)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.poInProgress)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.reorderLevel)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums font-bold text-error">{qty(row.shortfall)}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="px-3 py-8 border border-black text-center text-on-surface-variant italic">No pending order items found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
