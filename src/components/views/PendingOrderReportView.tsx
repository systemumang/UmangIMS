import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import Spinner from '@/src/components/common/Spinner';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import { fetchPendingOrderReport, type PendingOrderReportRow } from '@/src/lib/reports';

function qty(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value ?? 0));
}

export default function PendingOrderReportView() {
  const [rows, setRows] = useState<PendingOrderReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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

  const filteredRows = useMemo(() => {
    const query = filterQuery.trim().toLocaleLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${row.item ?? ''} ${row.category ?? ''}`.toLocaleLowerCase().includes(query));
  }, [filterQuery, rows]);

  useEffect(() => {
    setPage(1);
  }, [filterQuery, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [filteredRows.length, page, pageSize]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const exportToExcel = () => {
    if (!filteredRows.length) return;
    const header = ['Item', 'Category', 'Current Balance', 'PO In Progress', 'Re-Order Level', 'Shortfall'];
    const exportRows = filteredRows.map((row) => ({
      'Item': row.item || '',
      'Category': row.category || '',
      'Current Balance': Number(row.currentBalance || 0),
      'PO In Progress': Number(row.poInProgress || 0),
      'Re-Order Level': Number(row.reorderLevel || 0),
      'Shortfall': Number(row.shortfall || 0),
    }));
    downloadTextFile(
      `pending-order-report-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(header, exportRows),
      'text/csv; charset=utf-8'
    );
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-on-surface">Pending for Order</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="text-sm text-on-surface-variant">Showing: {filteredRows.length}</div>
          <button
            type="button"
            className="btn btn-sm flex items-center gap-1.5"
            onClick={exportToExcel}
            disabled={!filteredRows.length || loading}
            title="Download Excel"
          >
            <Download size={14} />
            <span>Download Excel</span>
          </button>
          <input
            className="h-9 w-56 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 text-sm outline-none"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter item or category..."
            aria-label="Filter pending order rows"
          />
          {filterQuery ? (
            <button type="button" className="btn btn-sm" onClick={() => setFilterQuery('')}>
              Clear
            </button>
          ) : null}
          <select
            className="h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Rows per page"
          >
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
      </div>
      {loading ? (
        <div className="p-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="p-4 text-sm text-error">{error}</div>
      ) : (
        <>
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
                {pageRows.length ? pageRows.map((row) => (
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
          <div className="px-4 py-3 border-t border-outline-variant">
            <Pagination totalItems={filteredRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}