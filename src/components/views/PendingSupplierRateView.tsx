import React, { useEffect, useMemo, useState } from 'react';
import { fetchPendingSupplierRates, updateRfqItemSupplierRate, type PendingSupplierRateRow } from '@/src/lib/purchaseRequests';
import { formatItemInline } from '@/src/lib/itemLabel';
import { fetchSpecifications, type Specification } from '@/src/lib/masters';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { cn } from '@/src/lib/utils';
import { sanitizeDecimalInput } from '@/src/lib/numberInput';
import { inputClass, LoadingCard, QueueCard } from '@/src/components/views/queues/shared';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';

export default function PendingSupplierRateView() {
  const [rows, setRows] = useState<PendingSupplierRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rateById, setRateById] = useState<Record<string, string>>({});
  const [filterSupplierId, setFilterSupplierId] = useState<string>('');
  const [filterItemId, setFilterItemId] = useState<string>('');
  const [savingAll, setSavingAll] = useState(false);

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

  const supplierOptions = useMemo(() => {
    const uniq = new Map<string, { value: string; label: string }>();
    for (const r of rows) {
      const id = String(r.supplierId ?? '').trim();
      if (!id) continue;
      const label = String(r.supplierName ?? r.supplierId ?? '').trim() || id;
      if (!uniq.has(id)) uniq.set(id, { value: id, label });
    }
    return Array.from(uniq.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const itemOptions = useMemo(() => {
    const uniq = new Map<string, { value: string; label: string }>();
    for (const r of rows) {
      const id = String(r.itemId ?? '').trim();
      if (!id) continue;
      const label = formatItemInline(r.item, r.specification, specNameById);
      if (!uniq.has(id)) uniq.set(id, { value: id, label });
    }
    return Array.from(uniq.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, specNameById]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterSupplierId && String(r.supplierId ?? '') !== filterSupplierId) return false;
      if (filterItemId && String(r.itemId ?? '') !== filterItemId) return false;
      return true;
    });
  }, [filterItemId, filterSupplierId, rows]);

  const editedRowIds = useMemo(
    () =>
      filteredRows
        .map((r) => r.rfqItemId)
        .filter((id) => String(rateById[id] ?? '').trim().length > 0),
    [filteredRows, rateById]
  );

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingCard label="Loading pending supplier rates..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load: {error}</div>
      ) : (
        <QueueCard title="Pending Supplier Rate" subtitle={`${pendingCount} pending`}>
          <div className="flex flex-wrap items-end gap-3 pb-3">
            <div className="min-w-[220px]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Supplier</div>
              <SearchableSelect
                value={filterSupplierId}
                options={supplierOptions}
                allowClear
                placeholder="All suppliers"
                onChange={(next) => setFilterSupplierId(String(next ?? '').trim())}
              />
            </div>
            <div className="min-w-[260px]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Item</div>
              <SearchableSelect
                value={filterItemId}
                options={itemOptions}
                allowClear
                placeholder="All items"
                onChange={(next) => setFilterItemId(String(next ?? '').trim())}
              />
            </div>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={savingAll || editedRowIds.length === 0}
              onClick={async () => {
                if (!editedRowIds.length) return;
                const invalid = editedRowIds.find((id) => {
                  const raw = String(rateById[id] ?? '').trim();
                  const rate = raw ? Number(raw) : NaN;
                  return !Number.isFinite(rate) || rate <= 0;
                });
                if (invalid) {
                  setError('Enter valid supplier rate for all edited rows.');
                  return;
                }

                setSavingAll(true);
                setError(null);
                try {
                  for (const id of editedRowIds) {
                    const raw = String(rateById[id] ?? '').trim();
                    const rate = Number(raw);
                    await updateRfqItemSupplierRate(id, rate);
                  }
                  const next = await fetchPendingSupplierRates();
                  setRows(next);
                  setRateById({});
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSavingAll(false);
                }
              }}
            >
              {savingAll ? 'Saving...' : `Save All (${editedRowIds.length})`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1170px] table-fixed text-left border-collapse border border-outline-variant">
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
                {filteredRows.length ? (
                  filteredRows.map((r) => (
                    <tr key={r.rfqItemId}>
                      <td className="px-3 py-2 text-sm text-primary border border-outline-variant">{r.rfqNumber || '-'}</td>
	                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.rfqDate ? formatDateDDMMYYYYOnly(r.rfqDate) : '-'}</td>
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
