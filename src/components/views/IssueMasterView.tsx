import React, { useEffect, useState } from 'react';
import { Search, Eye, Edit2, Trash2, ArrowUpDown } from 'lucide-react';
import { listIssues, deleteIssue, updateIssue, type StockTransaction } from '@/src/lib/stockMaster';
import { fetchDepartments, fetchFirms, fetchItems, fetchStores, type Department, type Firm, type Item, type Store } from '@/src/lib/masters';

export default function IssueMasterView() {
  const [issues, setIssues] = useState<StockTransaction[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<
    'transactionNo' | 'date' | 'issueType' | 'issuedTo' | 'firm' | 'store' | 'department' | 'person' | 'total'
  >('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewItem, setViewItem] = useState<StockTransaction | null>(null);
  const [editItem, setEditItem] = useState<StockTransaction | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const cloneTx = (row: StockTransaction) =>
    JSON.parse(JSON.stringify(row)) as StockTransaction;

  const downloadTextFile = (fileName: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportIssuesCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    const fileBase = `IssueMaster_${date}`.replace(/[^\w\-]+/g, '_');
    const headers = ['Issue No', 'Issue Date', 'Issue Type', 'Issued To', 'Firm', 'Store', 'Department', 'Issued By', 'Total Items'];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/\"/g, '""')}"`;
      return s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const row of filtered) {
      lines.push(
        [
          row.transactionNo,
          formatDate(row.date),
          row.issueType ?? 'Stock',
          row.issuedTo ?? '-',
          getFirmDisplay(row.firmId),
          row.store ?? '-',
          row.department ?? '',
          row.person ?? '',
          row.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0),
        ].map(esc).join(',')
      );
    }
    downloadTextFile(`${fileBase}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  };

  const exportIssuesPdf = () => {
    const date = new Date().toISOString().slice(0, 10);
    const title = `Issue Master ${date}`;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 16px; }
            h1 { font-size: 16px; margin: 0 0 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #000; padding: 6px; vertical-align: top; }
            th { background: #1d4ed8; color: #fff; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
            td.num { text-align: right; white-space: nowrap; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <table>
            <thead>
              <tr>
                <th>Issue No</th>
                <th>Issue Date</th>
                <th>Type</th>
                <th>Issued To</th>
                <th>Firm</th>
                <th>Store</th>
                <th>Department</th>
                <th>Issued By</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map((r) => {
                  const total = r.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
                  const cols = [
                    `<td>${String(r.transactionNo).replace(/</g, '&lt;')}</td>`,
                    `<td>${String(formatDate(r.date)).replace(/</g, '&lt;')}</td>`,
                    `<td>${String(r.issueType ?? 'Stock').replace(/</g, '&lt;')}</td>`,
                    `<td>${String(r.issuedTo ?? '-').replace(/</g, '&lt;')}</td>`,
                    `<td>${String(getFirmDisplay(r.firmId)).replace(/</g, '&lt;')}</td>`,
                    `<td>${String(r.store ?? '-').replace(/</g, '&lt;')}</td>`,
                    `<td>${String(r.department ?? '').replace(/</g, '&lt;')}</td>`,
                    `<td>${String(r.person ?? '').replace(/</g, '&lt;')}</td>`,
                    `<td class="num">${total}</td>`,
                  ];
                  return `<tr>${cols.join('')}</tr>`;
                })
                .join('')}
            </tbody>
          </table>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `.trim();
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    if (y && m && day) return `${day}/${m}/${y}`;
    return d;
  };

  const load = () => {
    listIssues().then(setIssues);
  };

  useEffect(() => {
    load();
    fetchFirms().then(setFirms).catch(() => setFirms([]));
    fetchStores().then(setStores).catch(() => setStores([]));
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
    fetchItems().then(setItems).catch(() => setItems([]));
  }, []);

  const firmOptions = firms
    .slice()
    .sort((a, b) => (String(a.sortName ?? '').trim() || a.name).localeCompare(String(b.sortName ?? '').trim() || b.name));

  const storeOptionsForFirm = (firmIdRaw?: string | null) => {
    const raw = String(firmIdRaw ?? '').trim();
    const firm = firms.find((f) => f.id === raw) ?? firms.find((f) => String(f.sortName ?? '').trim() === raw);
    if (!firm) return stores;
    return stores.filter((s) => s.firmId === firm.id);
  };

  const formatSpecs = (specificationsJson: string) => {
    const raw = String(specificationsJson ?? '').trim();
    if (!raw) return '';
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') return '';
      const entries = Object.entries(obj)
        .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()] as const)
        .filter(([k, v]) => k && v);
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => `${k}: ${v}`).join(' - ');
    } catch {
      return '';
    }
  };

  const getFullItemLabel = (item: Item) => {
    const name = String(item.itemName ?? '').trim();
    const desc = String(item.description ?? '').trim();
    const specText = formatSpecs(item.specificationsJson);
    const parts = [name, specText, desc].filter(Boolean);
    return parts.join(' - ') || item.itemCode;
  };

  const itemOptions = items.slice().sort((a, b) => getFullItemLabel(a).localeCompare(getFullItemLabel(b)));
  const getItemLabel = (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    const byId = items.find((it) => it.id === raw);
    if (byId) return getFullItemLabel(byId);
    const byCode = items.find((it) => String(it.itemCode ?? '').trim() === raw);
    if (byCode) return getFullItemLabel(byCode);
    const byName = items.find((it) => String(it.itemName ?? '').trim().toLowerCase() === raw.toLowerCase());
    if (byName) return getFullItemLabel(byName);
    return raw;
  };

  const getFirmDisplay = (value?: string | null) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    const byId = firms.find((f) => f.id === raw);
    if (byId) return String(byId.sortName ?? '').trim() || byId.name;
    const byName = firms.find((f) => f.name.toLowerCase() === raw.toLowerCase());
    if (byName) return String(byName.sortName ?? '').trim() || byName.name;
    return raw;
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this issue?')) return;
    await deleteIssue(id);
    load();
  };

  const saveEdit = async () => {
    if (!editItem) return;
    setEditBusy(true);
    try {
      await updateIssue(editItem.id, {
        firmId: editItem.firmId,
        store: editItem.store,
        department: editItem.department,
        person: editItem.person,
        date: editItem.date,
        issueType: editItem.issueType,
        issuedTo: editItem.issuedTo,
        items: editItem.items,
      });
      setEditItem(null);
      load();
    } finally {
      setEditBusy(false);
    }
  };

	  const filtered = issues.filter(i => 
	    i.transactionNo.toLowerCase().includes(q.toLowerCase()) ||
	    i.firmId.toLowerCase().includes(q.toLowerCase()) ||
	    i.department.toLowerCase().includes(q.toLowerCase()) ||
	    i.person.toLowerCase().includes(q.toLowerCase()) ||
	    (i.issueType ?? '').toLowerCase().includes(q.toLowerCase()) ||
	    (i.issuedTo ?? '').toLowerCase().includes(q.toLowerCase())
	  );

	  const onSort = (key: typeof sortBy) => {
	    if (sortBy === key) {
	      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
	      return;
	    }
	    setSortBy(key);
	    setSortDir('asc');
	  };

	  const sorted = [...filtered].sort((a, b) => {
	    const dir = sortDir === 'asc' ? 1 : -1;
	    const strCmp = (x: string, y: string) => x.localeCompare(y);
	    const totalA = a.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
	    const totalB = b.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
	    switch (sortBy) {
	      case 'transactionNo':
	        return dir * strCmp(a.transactionNo, b.transactionNo);
	      case 'date':
	        return dir * strCmp(String(a.date ?? ''), String(b.date ?? ''));
	      case 'issueType':
	        return dir * strCmp(String(a.issueType ?? ''), String(b.issueType ?? ''));
	      case 'issuedTo':
	        return dir * strCmp(String(a.issuedTo ?? ''), String(b.issuedTo ?? ''));
	      case 'firm':
	        return dir * strCmp(getFirmDisplay(a.firmId), getFirmDisplay(b.firmId));
	      case 'store':
	        return dir * strCmp(String(a.store ?? ''), String(b.store ?? ''));
	      case 'department':
	        return dir * strCmp(String(a.department ?? ''), String(b.department ?? ''));
	      case 'person':
	        return dir * strCmp(String(a.person ?? ''), String(b.person ?? ''));
	      case 'total':
	        return dir * (totalA - totalB);
	      default:
	        return 0;
	    }
	  });

	  return (
	    <div className="space-y-4">
	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
	        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
	          <div className="font-headline font-bold text-sm text-on-surface">Issue Master</div>
	          <div className="flex items-center gap-2">
	            <div className="relative w-64">
	              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
	              <input
	                type="text"
	                placeholder="Search issues..."
	                value={q}
	                onChange={(e) => setQ(e.target.value)}
	                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
	              />
	            </div>
	            <button type="button" className="btn btn-sm" onClick={exportIssuesCsv} title="Download Excel">
	              Excel
	            </button>
	            <button type="button" className="btn btn-sm" onClick={exportIssuesPdf} title="Download PDF">
	              Pdf
	            </button>
	          </div>
	        </div>
	        <div className="overflow-x-auto">
	          <table className="w-full text-left border-collapse text-sm">
	            <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
	              <tr>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('transactionNo')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Issue No</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('date')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Issue Date</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('issueType')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Issue Type</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('issuedTo')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Issued To</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('firm')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Firm</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('store')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Store Name</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('department')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Department</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black">
	                  <button type="button" onClick={() => onSort('person')} className="w-full px-3 py-3 flex items-center justify-between">
	                    <span>Issued By</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-0 border-b border-r border-black text-right">
	                  <button type="button" onClick={() => onSort('total')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
	                    <span>Total Items</span><ArrowUpDown size={12} />
	                  </button>
	                </th>
	                <th className="p-3 border-b border-outline-variant text-right">Action</th>
	              </tr>
	            </thead>
	            <tbody className="divide-y divide-outline-variant">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-on-surface-variant text-sm">
                    No issues found
                  </td>
                </tr>
              ) : null}
	              {sorted.map(row => (
	                <tr key={row.id} className="hover:bg-surface-container-low/50 transition-colors">
	                  <td className="p-3 border-r border-black text-on-surface font-medium">{row.transactionNo}</td>
	                  <td className="p-3 border-r border-black text-on-surface-variant">{formatDate(row.date)}</td>
	                  <td className="p-3 border-r border-black text-on-surface-variant">{row.issueType ?? 'Stock'}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant">{row.issuedTo ?? '-'}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant">{getFirmDisplay(row.firmId)}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant">{row.store ?? '-'}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant">{row.department}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant">{row.person}</td>
                  <td className="p-3 border-r border-black text-on-surface-variant text-right">{row.items.reduce((acc, it) => acc + it.quantity, 0)}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-3">
	                      <button type="button" className="text-primary hover:text-primary-dim transition-colors" title="View" onClick={() => setViewItem(row)}>
	                        <Eye size={16} />
	                      </button>
		                      <button type="button" className="text-primary hover:text-primary-dim transition-colors" title="Edit" onClick={() => setEditItem(cloneTx(row))}>
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
	        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 bg-black/50">
	          <div className="bg-surface-container-lowest rounded-none shadow-xl w-full max-w-none flex flex-col h-full">
	            <div className="p-4 border-b border-outline-variant flex justify-between items-center">
	              <div className="font-bold text-lg text-on-surface">Issue Details - {viewItem.transactionNo}</div>
	              <button className="btn btn-sm" onClick={() => setViewItem(null)}>Close</button>
	            </div>
	            <div className="p-5 overflow-auto space-y-6 flex-1">
	              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm bg-surface-container-low p-4 rounded-xl border border-outline-variant">
	                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Issue Date</span> {formatDate(viewItem.date)}</div>
	                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Issue Type</span> {viewItem.issueType ?? 'Stock'}</div>
	                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Issued To</span> {viewItem.issuedTo ?? '-'}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Firm</span> {getFirmDisplay(viewItem.firmId)}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Store Name</span> {viewItem.store ?? '-'}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Department</span> {viewItem.department}</div>
                <div><span className="font-bold text-[10px] uppercase text-on-surface-variant tracking-wider block mb-1">Issued By</span> {viewItem.person}</div>
              </div>
	              <div className="rounded-xl overflow-hidden border border-outline-variant">
	                <table className="w-full text-left border-collapse text-sm">
	                  <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
	                    <tr>
	                      <th className="p-3 border-b border-outline-variant">Item</th>
	                      <th className="p-3 border-b border-outline-variant text-right">Qty</th>
	                    </tr>
	                  </thead>
	                  <tbody className="divide-y divide-outline-variant">
	                    {viewItem.items.map((it, idx) => (
	                      <tr key={idx} className="hover:bg-surface-container-low/50">
	                        <td className="p-3 whitespace-pre-wrap">{getItemLabel(it.item)}</td>
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
	      {editItem ? (
	        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 bg-black/50">
	          <div className="bg-surface-container-lowest rounded-none shadow-xl w-full max-w-none flex flex-col h-full">
	            <div className="p-4 border-b border-outline-variant flex justify-between items-center">
	              <div className="font-bold text-lg text-on-surface">Edit Issue - {editItem.transactionNo}</div>
	              <div className="flex items-center gap-2">
	                <button className="btn btn-sm" onClick={() => setEditItem(null)} disabled={editBusy}>Cancel</button>
	                <button className="btn btn-sm" onClick={saveEdit} disabled={editBusy}>Save</button>
	              </div>
	            </div>
	            <div className="p-5 overflow-auto space-y-4 flex-1">
	              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
	                <label className="space-y-1">
	                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Firm</div>
	                  <select
	                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm"
	                    value={editItem.firmId ?? ''}
	                    onChange={(e) => setEditItem((p) => (p ? { ...p, firmId: e.target.value } : p))}
	                  >
	                    {(() => {
	                      const raw = String(editItem.firmId ?? '').trim();
	                      const exists = firmOptions.some((f) => f.id === raw);
	                      return !exists && raw ? <option value={raw}>{raw}</option> : null;
	                    })()}
	                    {firmOptions.map((f) => (
	                      <option key={f.id} value={f.id}>
	                        {String(f.sortName ?? '').trim() || f.name}
	                      </option>
	                    ))}
	                  </select>
	                </label>
	                <label className="space-y-1">
	                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Store</div>
	                  <select
	                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm"
	                    value={editItem.store ?? ''}
	                    onChange={(e) => setEditItem((p) => (p ? { ...p, store: e.target.value } : p))}
	                  >
	                    <option value="">-</option>
	                    {storeOptionsForFirm(editItem.firmId).map((s) => (
	                      <option key={s.id} value={s.name}>
	                        {s.name}
	                      </option>
	                    ))}
	                  </select>
	                </label>
	                <label className="space-y-1">
	                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Department</div>
	                  <select
	                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm"
	                    value={editItem.department ?? ''}
	                    onChange={(e) => setEditItem((p) => (p ? { ...p, department: e.target.value } : p))}
	                  >
	                    <option value="">-</option>
	                    {departments.map((d) => (
	                      <option key={d.id} value={d.name}>
	                        {d.name}
	                      </option>
	                    ))}
	                  </select>
	                </label>
                <label className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Issue Date</div>
                  <input type="date" className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm" value={String(editItem.date ?? '').slice(0,10)} onChange={(e) => setEditItem((p) => p ? ({ ...p, date: e.target.value }) : p)} />
                </label>
                <label className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Issue Type</div>
                  <select className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm" value={editItem.issueType ?? 'Stock'} onChange={(e) => setEditItem((p) => p ? ({ ...p, issueType: e.target.value as any }) : p)}>
                    <option value="Sales">Sales</option>
                    <option value="Project">Project</option>
                    <option value="Stock">Stock</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Issued To</div>
                  <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm" value={editItem.issuedTo ?? ''} onChange={(e) => setEditItem((p) => p ? ({ ...p, issuedTo: e.target.value }) : p)} />
                </label>
                <label className="space-y-1 md:col-span-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Issued By</div>
                  <input className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm" value={editItem.person ?? ''} onChange={(e) => setEditItem((p) => p ? ({ ...p, person: e.target.value }) : p)} />
                </label>
              </div>

	              <div className="rounded-xl overflow-hidden border border-outline-variant">
	                <table className="w-full text-left border-collapse text-sm">
	                  <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
	                    <tr>
	                      <th className="p-3 border-b border-outline-variant">Item</th>
	                      <th className="p-3 border-b border-outline-variant text-right">Qty</th>
	                    </tr>
	                  </thead>
	                  <tbody className="divide-y divide-outline-variant">
	                    {(editItem.items ?? []).map((it, idx) => (
	                      <tr key={idx}>
	                        <td className="p-3">
	                          <select
	                            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm"
	                            value={it.item ?? ''}
	                            title={it.specification ?? ''}
	                            onChange={(e) =>
	                              setEditItem((p) => {
	                                if (!p) return p;
	                                const nextItems = [...p.items];
	                                const selectedId = e.target.value;
	                                const selected = items.find((x) => x.id === selectedId);
	                                const nextSpec = selected ? formatSpecs(selected.specificationsJson) : nextItems[idx].specification ?? '';
	                                nextItems[idx] = { ...nextItems[idx], item: selectedId, specification: nextSpec };
	                                return { ...p, items: nextItems };
	                              })
	                            }
	                          >
	                            {(() => {
	                              const raw = String(it.item ?? '').trim();
	                              const exists = itemOptions.some((x) => x.id === raw);
	                              return !exists && raw ? <option value={raw}>{raw}</option> : null;
	                            })()}
	                            {itemOptions.map((opt) => (
	                              <option key={opt.id} value={opt.id}>
	                                {getFullItemLabel(opt)}
	                              </option>
	                            ))}
	                          </select>
	                        </td>
	                        <td className="p-2 text-right">
	                          <input type="number" className="w-28 text-right bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm" value={String(it.quantity ?? 0)} onChange={(e) => setEditItem((p) => {
	                            if (!p) return p;
	                            const nextItems = [...p.items];
	                            nextItems[idx] = { ...nextItems[idx], quantity: Number(e.target.value ?? 0) };
	                            return { ...p, items: nextItems };
	                          })} />
	                        </td>
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
