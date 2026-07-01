import React, { useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { formatPoNumber } from '@/src/lib/docNumbers';
import { fetchQueueExcessPaidInvoices, type PaymentQueueRow, type QueueFilters } from '@/src/lib/queues';
import Pagination from '@/src/components/common/Pagination';
import { ExportCsvButton, LoadingCard, QueueCard, QueueFiltersBar, useQueueMasters } from './shared';

export default function ExcessPaidInvoicesView() {
  const masters = useQueueMasters({ includeSuppliers: true });
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
    setLoading(true);
    setError(null);
    fetchQueueExcessPaidInvoices(filters, ac.signal)
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

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  return (
    <div className="space-y-6">
      <div className="hidden">
        <div className="text-sm text-on-surface-variant">Excess Paid Invoices</div>
        <ExportCsvButton
          id="excess-paid-export-btn"
          filename={`queue-excess-paid-invoices-${new Date().toISOString().slice(0, 10)}.csv`}
          rows={rows}
          disabled={loading}
        />
      </div>
      <QueueFiltersBar filters={filters} onChange={setFilters} masters={mastersForFilters} />

      {loading ? (
        <LoadingCard label="Loading excess paid invoices..." />
      ) : error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-4 text-sm text-on-surface">Failed to load queue: {error}</div>
      ) : (
        <QueueCard title="Excess Paid Invoices" subtitle={`${rows.length} invoices`} hideHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] table-fixed text-left border-collapse border border-outline-variant">
              <colgroup>
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[160px]" />
                <col className="w-[220px]" />
                <col className="w-[220px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Invoice</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Date</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">PO</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Firm</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Supplier</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Amount</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Advance</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Paid</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Balance</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-outline-variant">Tally Date</th>
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
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.invoiceAmount ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.adjustedAmount ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.paidAmount ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant tabular-nums">{Number(r.remainingAmount ?? 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-sm text-on-surface-variant border border-outline-variant">{r.tallyEntryDate ? formatDateDDMMYYYYOnly(r.tallyEntryDate) : '-'}</td>
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
          <div className="pt-3">
            <Pagination totalItems={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </QueueCard>
      )}
    </div>
  );
}
