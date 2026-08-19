import React, { useEffect, useMemo, useState } from 'react';
import { listIssues, listReturns, type StockTransaction } from '@/src/lib/stockMaster';
import { fetchFirms, fetchStores, type Firm, type Store } from '@/src/lib/masters';

type SummaryLine = {
  id: string;
  date: string;
  firm: string;
  issueTo?: string;
  department: string;
  storeName?: string;
  receivedBy?: string;
  item: string;
  qty: number;
  remarks: string;
};

function formatDate(value: string) {
  if (!value) return '-';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function txDate(value: string) {
  return String(value ?? '').slice(0, 10);
}

export default function StockSummaryView() {
  const [issues, setIssues] = useState<StockTransaction[]>([]);
  const [returns, setReturns] = useState<StockTransaction[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listIssues().catch(() => []),
      listReturns().catch(() => []),
      fetchFirms().catch(() => []),
      fetchStores().catch(() => []),
    ])
      .then(([issueRows, returnRows, firmRows, storeRows]) => {
        if (!active) return;
        setIssues(issueRows);
        setReturns(returnRows);
        setFirms(firmRows);
        setStores(storeRows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const firmNameById = useMemo(() => new Map(firms.map((f) => [f.id, f.name])), [firms]);
  const storeNameById = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const inDateRange = (date: string) => {
    const d = txDate(date);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const issueLines = useMemo<SummaryLine[]>(
    () =>
      issues
        .filter((tx) => inDateRange(tx.date))
        .flatMap((tx) =>
          tx.items.map((it, index) => ({
            id: `${tx.id}-${index}`,
            date: txDate(tx.date),
            firm: firmNameById.get(tx.firmId) || tx.firmId || '-',
            issueTo: tx.issuedTo || tx.projectId || tx.customerName || '-',
            department: tx.department || '-',
            item: it.item || '-',
            qty: Number(it.quantity) || 0,
            remarks: it.remark || '',
          }))
        )
        .sort((a, b) => b.date.localeCompare(a.date) || a.firm.localeCompare(b.firm)),
    [issues, firmNameById, fromDate, toDate]
  );

  const returnLines = useMemo<SummaryLine[]>(
    () =>
      returns
        .filter((tx) => inDateRange(tx.date))
        .flatMap((tx) =>
          tx.items.map((it, index) => ({
            id: `${tx.id}-${index}`,
            date: txDate(tx.date),
            firm: firmNameById.get(tx.firmId) || tx.firmId || '-',
            department: tx.department || '-',
            storeName: tx.store || (tx.storeId ? storeNameById.get(tx.storeId) : '') || '-',
            receivedBy: tx.person || tx.approvedBy || '-',
            item: it.item || '-',
            qty: Number(it.quantity) || 0,
            remarks: it.remark || '',
          }))
        )
        .sort((a, b) => b.date.localeCompare(a.date) || a.firm.localeCompare(b.firm)),
    [returns, firmNameById, storeNameById, fromDate, toDate]
  );

  const totalIssueQty = issueLines.reduce((sum, row) => sum + row.qty, 0);
  const totalReturnQty = returnLines.reduce((sum, row) => sum + row.qty, 0);
  const headerClass = 'px-3 py-2 border border-outline-variant bg-white !text-black text-[10px] font-bold uppercase tracking-wider';
  const cellClass = 'px-3 py-2 border border-outline-variant text-on-surface-variant align-top';

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 flex-wrap">
          <div className="font-headline font-bold text-sm text-on-surface">Summary</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" className="input h-[38px] w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input type="date" className="input h-[38px] w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <button type="button" className="btn btn-sm h-[38px] px-3" onClick={() => { setFromDate(''); setToDate(''); }}>
              Clear
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Issue Qty</div>
              <div className="text-lg font-semibold text-on-surface">{totalIssueQty}</div>
            </div>
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Return Qty</div>
              <div className="text-lg font-semibold text-on-surface">{totalReturnQty}</div>
            </div>
          </div>

          <section className="space-y-2">
            <div className="text-sm font-bold text-on-surface">Issue</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm border-2 border-outline-variant border-collapse">
                <thead>
                  <tr>
                    <th className={headerClass}>Issue Date</th>
                    <th className={headerClass}>Firm</th>
                    <th className={headerClass}>Issue To</th>
                    <th className={headerClass}>Department</th>
                    <th className={headerClass}>Item</th>
                    <th className={`${headerClass} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {loading || issueLines.length === 0 ? (
                    <tr><td colSpan={6} className={`${cellClass} text-center`}>{loading ? 'Loading...' : 'No issue rows found.'}</td></tr>
                  ) : issueLines.map((row) => (
                    <tr key={row.id}>
                      <td className={cellClass}>{formatDate(row.date)}</td>
                      <td className={cellClass}>{row.firm}</td>
                      <td className={cellClass}>{row.issueTo}</td>
                      <td className={cellClass}>{row.department}</td>
                      <td className={cellClass}>{row.item}</td>
                      <td className={`${cellClass} text-right font-semibold`}>{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-sm font-bold text-on-surface">Return</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm border-2 border-outline-variant border-collapse">
                <thead>
                  <tr>
                    <th className={headerClass}>Date</th>
                    <th className={headerClass}>Firm</th>
                    <th className={headerClass}>Department</th>
                    <th className={headerClass}>Store Name</th>
                    <th className={headerClass}>Received By</th>
                    <th className={headerClass}>Item</th>
                    <th className={`${headerClass} text-right`}>Qty</th>
                    <th className={headerClass}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {loading || returnLines.length === 0 ? (
                    <tr><td colSpan={8} className={`${cellClass} text-center`}>{loading ? 'Loading...' : 'No return rows found.'}</td></tr>
                  ) : returnLines.map((row) => (
                    <tr key={row.id}>
                      <td className={cellClass}>{formatDate(row.date)}</td>
                      <td className={cellClass}>{row.firm}</td>
                      <td className={cellClass}>{row.department}</td>
                      <td className={cellClass}>{row.storeName}</td>
                      <td className={cellClass}>{row.receivedBy}</td>
                      <td className={cellClass}>{row.item}</td>
                      <td className={`${cellClass} text-right font-semibold`}>{row.qty}</td>
                      <td className={cellClass}>{row.remarks || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
