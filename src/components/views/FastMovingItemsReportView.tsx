import React, { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import Pagination from '@/src/components/common/Pagination';
import Spinner from '@/src/components/common/Spinner';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';
import { fetchItemNames, fetchItems, type Item, type ItemName } from '@/src/lib/masters';
import { fetchStockSummary, type StockSummaryRow } from '@/src/lib/reports';
import { listDamages, listIssues, listReturns, listTransfers, type StockTransaction } from '@/src/lib/stockMaster';

type FastMovingRow = {
  itemId: string;
  item: string;
  category: string;
  issueQuantity: number;
  issueCount: number;
  currentStock: number;
  poInProgress: number;
  reorderLevel: number;
  shortfall: number;
};

type StockMovement = {
  id: string;
  date: string;
  type: 'Issue' | 'Return' | 'Damage' | 'Transfer';
  reference: string;
  party: string;
  quantity: number;
  direction: 'In' | 'Out';
};

function qty(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value ?? 0));
}

function issueDate(issue: StockTransaction) {
  return String(issue.date ?? '').slice(0, 10);
}

function stockLookupKey(value: unknown) {
  return String(value ?? '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function FastMovingItemsReportView() {
  const [issues, setIssues] = useState<StockTransaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemNames, setItemNames] = useState<ItemName[]>([]);
  const [stockRows, setStockRows] = useState<StockSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [itemNameFilter, setItemNameFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [limit, setLimit] = useState(100);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedItem, setSelectedItem] = useState<FastMovingRow | null>(null);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([listIssues(), fetchItems(), fetchItemNames(), fetchStockSummary()])
      .then(([nextIssues, nextItems, nextItemNames, nextStockRows]) => {
        if (!active) return;
        setIssues(nextIssues);
        setItems(nextItems);
        setItemNames(nextItemNames);
        setStockRows(nextStockRows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categoryByItemId = useMemo(() => {
    const itemNameById = new Map(itemNames.map((itemName) => [String(itemName.id), itemName]));
    return new Map(
      items.map((item) => [
        String(item.id),
        String(itemNameById.get(String(item.itemNameId))?.itemCategoryName ?? '').trim() || 'Uncategorised',
      ])
    );
  }, [itemNames, items]);

  const stockByItemId = useMemo(() => new Map(stockRows.map((row) => [String(row.itemId), row])), [stockRows]);
  const stockByItemLabel = useMemo(
    () => new Map(stockRows.map((row) => [stockLookupKey(row.item), row])),
    [stockRows]
  );


  const allRows = useMemo(() => {
    const grouped = new Map<string, FastMovingRow>();
    for (const issue of issues) {
      const date = issueDate(issue);
      if ((fromDate && (!date || date < fromDate)) || (toDate && (!date || date > toDate))) continue;
      for (const line of issue.items ?? []) {
        const quantity = Number(line.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        const itemId = String(line.itemId ?? '').trim() || String(line.item ?? '').trim();
        if (!itemId) continue;
        const item = String(line.item ?? '').trim() || '-';
        const stock = stockByItemId.get(itemId) ?? stockByItemLabel.get(stockLookupKey(item));
        const current = grouped.get(itemId) ?? {
          itemId,
          item,
          category: categoryByItemId.get(itemId) ?? 'Uncategorised',
          issueQuantity: 0,
          issueCount: 0,
          currentStock: Number(stock?.currentBalance ?? stock?.closingStock ?? 0),
          poInProgress: Number(stock?.poInProgress ?? 0),
          reorderLevel: Number(stock?.reorderLevel ?? 0),
          shortfall: Number(stock?.shortfall ?? 0),
        };
        current.issueQuantity += quantity;
        current.issueCount += 1;
        grouped.set(itemId, current);
      }
    }
    return Array.from(grouped.values());
  }, [categoryByItemId, fromDate, issues, stockByItemId, stockByItemLabel, toDate]);

  const categories = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.category))).sort((a, b) => a.localeCompare(b)),
    [allRows]
  );

  const filteredRows = useMemo(() => {
    const itemQuery = itemNameFilter.trim().toLocaleLowerCase();
    return allRows
      .filter((row) => {
        if (categoryFilter && row.category !== categoryFilter) return false;
        if (itemQuery && !row.item.toLocaleLowerCase().includes(itemQuery)) return false;
        return true;
      })
      .sort((a, b) => b.issueQuantity - a.issueQuantity || a.item.localeCompare(b.item));
  }, [allRows, categoryFilter, itemNameFilter]);

  const visibleRows = useMemo(() => (limit > 0 ? filteredRows.slice(0, limit) : filteredRows), [filteredRows, limit]);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, itemNameFilter, categoryFilter, limit, pageSize]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleRows.slice(start, start + pageSize);
  }, [page, pageSize, visibleRows]);

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setItemNameFilter('');
    setCategoryFilter('');
    setLimit(100);
  };

  const openStockMovement = async (row: FastMovingRow) => {
    setSelectedItem(row);
    setMovementLoading(true);
    setMovementError(null);
    setStockMovements([]);
    try {
      const [returns, damages, transfers] = await Promise.all([listReturns(), listDamages(), listTransfers()]);
      const matchesItem = (transaction: StockTransaction, line: StockTransaction['items'][number]) =>
        String(line.itemId ?? '').trim() === row.itemId ||
        stockLookupKey(line.item) === stockLookupKey(row.item);
      const toMovements = (
        transactions: StockTransaction[],
        type: StockMovement['type'],
        direction: StockMovement['direction']
      ) => transactions.flatMap((transaction) =>
        (transaction.items ?? [])
          .filter((line) => matchesItem(transaction, line))
          .map((line, index) => ({
            id: `${type}-${transaction.id}-${index}`,
            date: issueDate(transaction),
            type,
            reference: transaction.transactionNo || '-',
            party: type === 'Transfer'
              ? `${transaction.store || transaction.department || '-'} → ${transaction.toStore || transaction.toDepartment || '-'}`
              : transaction.projectName || transaction.customerName || transaction.person || transaction.department || '-',
            quantity: Number(line.quantity ?? 0),
            direction,
          }))
      );
      setStockMovements([
        ...toMovements(issues, 'Issue', 'Out'),
        ...toMovements(returns, 'Return', 'In'),
        ...toMovements(damages, 'Damage', 'Out'),
        ...toMovements(transfers, 'Transfer', 'Out'),
      ].sort((a, b) => b.date.localeCompare(a.date) || b.reference.localeCompare(a.reference)));
    } catch (e) {
      setMovementError(e instanceof Error ? e.message : 'Failed to load stock movement.');
    } finally {
      setMovementLoading(false);
    }
  };

  const exportToExcel = () => {
    if (!visibleRows.length) return;
    const header = [
      'Rank',
      'Item',
      'Category',
      'Issue Quantity',
      'Issue Entries',
      'Current Stock',
      'PO in Progress',
      'Re-Order Level',
      'Shortfall',
    ];
    const exportRows = visibleRows.map((row, index) => ({
      'Rank': index + 1,
      'Item': row.item || '',
      'Category': row.category || '',
      'Issue Quantity': Number(row.issueQuantity || 0),
      'Issue Entries': Number(row.issueCount || 0),
      'Current Stock': Number(row.currentStock || 0),
      'PO in Progress': Number(row.poInProgress || 0),
      'Re-Order Level': Number(row.reorderLevel || 0),
      'Shortfall': Number(row.shortfall || 0),
    }));
    downloadTextFile(
      `fast-moving-items-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(header, exportRows),
      'text/csv; charset=utf-8'
    );
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-on-surface">Fast Moving Items</div>
          <div className="text-xs text-on-surface-variant mt-0.5">Ranked by Issue Quantity</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-on-surface-variant">Showing: {pageRows.length} / {visibleRows.length}</div>
          <button
            type="button"
            className="btn btn-sm flex items-center gap-1.5"
            onClick={exportToExcel}
            disabled={!visibleRows.length || loading}
            title="Download Excel"
          >
            <Download size={14} />
            <span>Download Excel</span>
          </button>
        </div>
      </div>

      <div className="p-4 border-b border-outline-variant grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
        <label className="text-xs font-medium text-on-surface-variant">
          From Date
          <input type="date" className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          To Date
          <input type="date" className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          Item Name
          <input className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 text-sm outline-none" value={itemNameFilter} onChange={(e) => setItemNameFilter(e.target.value)} placeholder="Filter item name..." />
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          Item Category
          <select className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          Results
          <select className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={25}>Top 25</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
            <option value={250}>Top 250</option>
            <option value={0}>All Items</option>
          </select>
        </label>
        <label className="text-xs font-medium text-on-surface-variant">
          Rows
          <select className="mt-1 w-full h-9 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 text-sm outline-none" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="btn btn-sm w-full h-9" onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="p-4 text-sm text-error">{error}</div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-[1200px] w-full text-sm border-collapse border border-black">
            <thead className="bg-primary text-on-primary text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-right border border-black w-16">Rank</th>
                <th className="px-3 py-2 text-left border border-black">Item</th>
                <th className="px-3 py-2 text-left border border-black">Category</th>
                <th className="px-3 py-2 text-right border border-black">Issue Quantity</th>
                <th className="px-3 py-2 text-right border border-black">Issue Entries</th>
                <th className="px-3 py-2 text-right border border-black">Current Stock</th>
                <th className="px-3 py-2 text-right border border-black">PO in Progress</th>
                <th className="px-3 py-2 text-right border border-black">Re-Order Level</th>
                <th className="px-3 py-2 text-right border border-black">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((row, index) => (
                <tr key={row.itemId} className="hover:bg-surface-container-low/50">
                  <td className="px-3 py-2 border border-black text-right tabular-nums font-semibold">{(page - 1) * pageSize + index + 1}</td>
                  <td className="px-3 py-2 border border-black font-semibold">
                    <button
                      type="button"
                      onClick={() => void openStockMovement(row)}
                      className="text-left text-primary underline underline-offset-2 hover:text-primary-dim focus:outline-none focus:ring-2 focus:ring-primary rounded"
                      title={`View stock movement for ${row.item}`}
                    >
                      {row.item}
                    </button>
                  </td>
                  <td className="px-3 py-2 border border-black">{row.category}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums font-bold">{qty(row.issueQuantity)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{row.issueCount}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.currentStock)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.poInProgress)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums">{qty(row.reorderLevel)}</td>
                  <td className="px-3 py-2 border border-black text-right tabular-nums font-bold text-error">{qty(row.shortfall)}</td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="px-3 py-8 border border-black text-center text-on-surface-variant italic">No issued items match the selected filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error ? (
        <div className="px-4 py-3 border-t border-outline-variant">
          <Pagination totalItems={visibleRows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
      ) : null}
      {selectedItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl flex flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-on-surface">Stock Movement</h2>
                <p className="mt-1 text-sm text-on-surface-variant break-words">{selectedItem.item}</p>
              </div>
              <button type="button" onClick={() => setSelectedItem(null)} className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface" aria-label="Close stock movement">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-auto p-4">
              {movementLoading ? <div className="p-8 flex justify-center"><Spinner /></div> : movementError ? (
                <div className="p-4 text-sm text-error">{movementError}</div>
              ) : stockMovements.length ? (
                <table className="min-w-[720px] w-full text-sm border-collapse border border-black">
                  <thead className="bg-primary text-on-primary text-xs uppercase tracking-wider">
                    <tr><th className="px-3 py-2 text-left border border-black">Date</th><th className="px-3 py-2 text-left border border-black">Movement</th><th className="px-3 py-2 text-left border border-black">Reference</th><th className="px-3 py-2 text-left border border-black">Project / Party</th><th className="px-3 py-2 text-right border border-black">In</th><th className="px-3 py-2 text-right border border-black">Out</th></tr>
                  </thead>
                  <tbody>
                    {stockMovements.map((movement) => <tr key={movement.id}>
                      <td className="px-3 py-2 border border-black whitespace-nowrap">{movement.date || '-'}</td>
                      <td className="px-3 py-2 border border-black">{movement.type}</td>
                      <td className="px-3 py-2 border border-black">{movement.reference}</td>
                      <td className="px-3 py-2 border border-black">{movement.party}</td>
                      <td className="px-3 py-2 border border-black text-right tabular-nums text-emerald-700">{movement.direction === 'In' ? qty(movement.quantity) : '-'}</td>
                      <td className="px-3 py-2 border border-black text-right tabular-nums text-error">{movement.direction === 'Out' ? qty(movement.quantity) : '-'}</td>
                    </tr>)}
                  </tbody>
                </table>
              ) : <div className="p-8 text-center text-sm text-on-surface-variant">No stock movement found for this item.</div>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
