import React, { useEffect, useState } from 'react';
import { Search, Eye, Edit2, Trash2 } from 'lucide-react';
import { listReturns, deleteReturn, type StockTransaction } from '@/src/lib/stockMaster';

export default function ReturnMasterView() {
  const [returns, setReturns] = useState<StockTransaction[]>([]);
  const [q, setQ] = useState('');
  const [viewItem, setViewItem] = useState<StockTransaction | null>(null);

  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    if (y && m && day) return `${day}/${m}/${y}`;
    return d;
  };

  const load = () => {
    listReturns().then(setReturns);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this return?')) return;
    await deleteReturn(id);
    load();
  };

  const filtered = returns.filter(i => 
    i.transactionNo.toLowerCase().includes(q.toLowerCase()) ||
    i.firmId.toLowerCase().includes(q.toLowerCase()) ||
    i.department.toLowerCase().includes(q.toLowerCase()) ||
    i.person.toLowerCase().includes(q.toLowerCase()) ||
    (i.returnType ?? '').toLowerCase().includes(q.toLowerCase()) ||
    (i.customerName ?? '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Return Master</div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
            <input
              type="text"
              placeholder="Search returns..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
              <tr>
                <th className="p-3 border-b border-outline-variant">Return No</th>
                <th className="p-3 border-b border-outline-variant">Return Date</th>
                <th className="p-3 border-b border-outline-variant">Return Type</th>
                <th className="p-3 border-b border-outline-variant">Customer Name</th>
                <th className="p-3 border-b border-outline-variant">Firm</th>
                <th className="p-3 border-b border-outline-variant">Department</th>
                <th className="p-3 border-b border-outline-variant">Received By</th>                <th className="p-3 border-b border-outline-variant text-right">Total Items</th>
                <th className="p-3 border-b border-outline-variant text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-on-surface-variant text-sm">
                    No returns found
                  </td>
                </tr>
              ) : null}
              {filtered.map(row => (
                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="p-3 text-on-surface font-medium">{row.transactionNo}</td>
                  <td className="p-3 text-on-surface-variant">{formatDate(row.date)}</td>
                  <td className="p-3 text-on-surface-variant">{row.returnType ?? 'Stock'}</td>
                  <td className="p-3 text-on-surface-variant">{row.customerName ?? '-'}</td>
                  <td className="p-3 text-on-surface-variant">{row.firmId}</td>
                  <td className="p-3 text-on-surface-variant">{row.department}</td>
                  <td className="p-3 text-on-surface-variant">{row.person}</td>
                  <td className="p-3 text-on-surface-variant text-right">{row.items.reduce((acc, it) => acc + it.quantity, 0)}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button type="button" className="text-primary hover:text-primary-dim transition-colors" title="View" onClick={() => setViewItem(row)}>
                        <Eye size={16} />
                      </button>
                      <button type="button" className="text-primary hover:text-primary-dim transition-colors" title="Edit">
                        <Edit2 size={16} />
                      </button>
                      <button type="button" className="text-error hover:text-error/80 transition-colors" title="Delete" onClick={() => handleDelete(row.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {viewItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface-container-lowest rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-outline-variant flex justify-between items-center">
              <div className="font-bold text-lg text-on-surface">Return Details - {viewItem.transactionNo}</div>
              <button className="btn btn-sm" onClick={() => setViewItem(null)}>Close</button>
            </div>
            <div className="p-5 overflow-auto space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Return Date</span> {formatDate(viewItem.date)}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Return Type</span> {viewItem.returnType ?? 'Stock'}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Customer Name</span> {viewItem.customerName ?? '-'}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Firm</span> {viewItem.firmId}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Department</span> {viewItem.department}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Returned By</span> {viewItem.person}</div>
              </div>
              <div className="rounded-xl overflow-hidden border border-outline-variant">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                    <tr>
                      <th className="p-3 border-b border-outline-variant">Item</th>
                      <th className="p-3 border-b border-outline-variant">Specification</th>
                      <th className="p-3 border-b border-outline-variant text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {viewItem.items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-surface-container-low/50">
                        <td className="p-3">{it.item}</td>
                        <td className="p-3 whitespace-pre-wrap">{it.specification}</td>
                        <td className="p-3 text-right font-medium">{it.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

