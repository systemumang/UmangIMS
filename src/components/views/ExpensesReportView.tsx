import React, { useEffect, useMemo, useState } from 'react';
import Spinner from '@/src/components/common/Spinner';
import { fetchExpenseReport, type ExpenseReportRow } from '@/src/lib/reports';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { inputClass, labelClass } from './queues/shared';

function money(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export default function ExpensesReportView() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expense, setExpense] = useState('');
  const [rows, setRows] = useState<ExpenseReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchExpenseReport({ from, to, expense }, ac.signal)
      .then(setRows)
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [from, to, expense]);

  const expenseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const label = String(row.expenses ?? '').trim();
      const key = String(row.expenseId ?? label).trim();
      if (key && label) map.set(key, label);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant flex flex-wrap items-end gap-3">
        <label className="w-44 space-y-1">
          <div className={labelClass}>From</div>
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="w-44 space-y-1">
          <div className={labelClass}>To</div>
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="min-w-[260px] flex-1 space-y-1">
          <div className={labelClass}>Select Expenses</div>
          <select className={inputClass} value={expense} onChange={(e) => setExpense(e.target.value)}>
            <option value="">All Expenses</option>
            {expenseOptions.map((it) => (
              <option key={it.value} value={it.value}>{it.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm h-[38px]" onClick={() => { setFrom(''); setTo(''); setExpense(''); }}>
          Clear
        </button>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-on-surface">Expenses</div>
          <div className="text-sm font-bold text-on-surface">Total: {money(total)}</div>
        </div>
        {loading ? (
          <div className="p-10 flex justify-center"><Spinner /></div>
        ) : error ? (
          <div className="p-4 text-sm text-error">{error}</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[860px] w-full text-sm border-collapse border border-black">
              <thead className="bg-primary text-on-primary text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left border border-black">Date</th>
                  <th className="px-3 py-2 text-left border border-black">Invoice No</th>
                  <th className="px-3 py-2 text-left border border-black">Expenses</th>
                  <th className="px-3 py-2 text-left border border-black">Supplier</th>
                  <th className="px-3 py-2 text-right border border-black">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row, idx) => (
                  <tr key={`${row.invoiceNo}-${row.expenseId ?? row.expenses}-${idx}`}>
                    <td className="px-3 py-2 border border-black whitespace-nowrap">{row.date ? formatDateDDMMYYYYOnly(row.date) : '-'}</td>
                    <td className="px-3 py-2 border border-black">{row.invoiceNo || '-'}</td>
                    <td className="px-3 py-2 border border-black">{row.expenses || '-'}</td>
                    <td className="px-3 py-2 border border-black">{row.supplier || '-'}</td>
                    <td className="px-3 py-2 border border-black text-right tabular-nums">{money(row.amount)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-3 py-8 border border-black text-center text-on-surface-variant italic">No expenses found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
