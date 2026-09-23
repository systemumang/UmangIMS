import React, { useEffect, useMemo, useState } from 'react';
import Pagination from '@/src/components/common/Pagination';
import Spinner from '@/src/components/common/Spinner';
import { fetchItemNames, fetchItems, type Item, type ItemName } from '@/src/lib/masters';
import { fetchStockSummary, type StockSummaryRow } from '@/src/lib/reports';
import { listIssues, type StockTransaction } from '@/src/lib/stockMaster';

type FastMovingRow = {
  itemId: string;
  item: string;
  category: string;
  issueQuantity: number;
  issueCount: number;
};

function qty(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value ?? 0));
}

function issueDate(issue: StockTransaction) {
  return String(issue.date ?? '').slice(0, 10);
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
    () => new Map(stockRows.map((row) => [String(row.item ?? '').trim().toLocaleLowerCase(), row])),
    [stockRows]
  );

  const categories = useMemo(
    () => Array.from(new Set(Array.from(categoryByItemId.values()))).sort((a, b) => a.localeCompare(b)),
    [categoryByItemId]
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
        const current = grouped.get(itemId) ?? {
          itemId,
          item,
          category: categoryByItemId.get(itemId) ?? 'Uncategorised',
          issueQuantity: 0,
          issueCount: 0,
        };
        current.issueQuantity += quantity;
        current.issueCount += 1;
        grouped.set(itemId, current);
      }
    }
    return Array.from(grouped.values());
  }, [categoryByItemId, fromDate, issues, stockByItemId, stockByItemLabel, toDate]);

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

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-on-surface">Fast Moving Items</div>
          <div className="text-xs text-on-surface-variant mt-0.5">Ranked by Issue Quantity</div>
        </div>
        <div className="text-sm text-on-surface-variant">Showing: {pageRows.length} / {visibleRows.length}</div>
      </div>

      <div className="p-4 border-b border-outline-variant grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
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
                <tr key={row.itemId}>
                  <td className="px-3 py-2 border border-black text-right tabular-nums font-semibold">{(page - 1) * pageSize + index + 1}</td>
                  <td className="px-3 py-2 border border-black font-semibold">{row.item}</td>
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
    </div>
  );
}