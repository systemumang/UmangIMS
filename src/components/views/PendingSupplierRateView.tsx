import React, { useEffect, useMemo, useState } from 'react';
import { fetchPendingSupplierRates, updateRfqItemSupplierRate, type PendingSupplierRateRow } from '@/src/lib/purchaseRequests';
import { formatItemInline } from '@/src/lib/itemLabel';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import { cn } from '@/src/lib/utils';
import { sanitizeDecimalInput } from '@/src/lib/numberInput';
import { inputClass, LoadingCard, QueueCard } from '@/src/components/views/queues/shared';

export default function PendingSupplierRateView() {
  const [rows, setRows] = useState<PendingSupplierRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rateById, setRateById] = useState<Record<string, string>>({});

  const [specs, setSpecs] = useState<Specification[]>([]);
  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  const reload = () => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchPendingSupplierRates(ac.signal)
      .then((r) => {
        setRows(r);
        setRateById((prev) => {
          const next = { ...prev };
          for (const row of r) {
            if (next[row.rfqItemId] == null || next[row.rfqItemId] === '') next[row.rfqItemId] = '';
          }
          return next;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    return () => ac.abort();
  };

  useEffect(() => reload(), []);

  const pendingCount = rows.length;

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingCard label="Loading pending supplier rates..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load: {error}</div>
      ) : (
        <QueueCard title="Pending Supplier Rate" subtitle={`${pendingCount} pending`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[420px]" />
                <col className="w-[220px]" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">RFQ</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Date</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Item</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Qty</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier Rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.rfqItemId}>
                      <td className="px-3 py-2 text-sm text-primary border border-outline-variant">{r.rfqNumber || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.rfqDate || '-'}</td>
                      <td className="px-3 py-2 text-sm text-on-surface border border-outline-variant whitespace-normal break-words">
                        {formatItemInline(r.item, r.specification, specNameById)}
                      </td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant whitespace-normal break-words">
                        {r.supplierName || r.supplierId || '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.quantity ?? 0) || 0}</td>
                      <td className="px-3 py-2 border border-outline-variant">
                        <div className="flex items-center gap-2">
                          <input
                            className={cn(inputClass, 'py-1.5')}
                            value={rateById[r.rfqItemId] ?? ''}
                            onChange={(e) =>
                              setRateById((prev) => ({
                                ...prev,
                                [r.rfqItemId]: sanitizeDecimalInput(e.target.value),
                              }))
                            }
                            type="text"
                            inputMode="decimal"
                            placeholder="Rate"
                          />
                          <button
                            type="button"
                            className="btn-primary btn-sm min-w-[84px]"
                            disabled={savingId === r.rfqItemId}
                            onClick={() => {
                              const raw = String(rateById[r.rfqItemId] ?? '').trim();
                              const rate = raw ? Number(raw) : NaN;
                              if (!Number.isFinite(rate) || rate <= 0) {
                                setError('Enter valid supplier rate.');
                                return;
                              }
                              setSavingId(r.rfqItemId);
                              setError(null);
                              updateRfqItemSupplierRate(r.rfqItemId, rate)
                                .then(() => fetchPendingSupplierRates().then(setRows))
                                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                                .finally(() => setSavingId(null));
                            }}
                          >
                            {savingId === r.rfqItemId ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-5 text-sm text-on-surface-variant border border-outline-variant" colSpan={6}>
                      No pending supplier rates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </QueueCard>
      )}
    </div>
  );
}

