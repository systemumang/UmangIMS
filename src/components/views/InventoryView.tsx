import React, { useEffect, useMemo, useState } from 'react';
import { Search, Settings, Save, ArrowUpDown } from 'lucide-react';
import { fetchFirms, fetchStores, fetchItems, type Firm, type Store, type Item } from '@/src/lib/masters';
import { fetchInventorySheet, fetchOpeningBalances, saveOpeningBalances, type InventorySheetRow } from '@/src/lib/inventory';
import { listDamages, listIssues, listReturns, listTransfers, type StockTransaction } from '@/src/lib/stockMaster';
import Spinner from '@/src/components/common/Spinner';
import { Modal, inputClass, labelClass } from './queues/shared';

const ALL_FIRMS_VALUE = '__all_firms__';

export default function InventoryView() {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>('');
  const [selectedStoreFilterId, setSelectedStoreFilterId] = useState<string>('');
  const [rows, setRows] = useState<InventorySheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'itemName' | 'firm' | 'store' | 'opening' | 'reorderLevel' | 'purchase' | 'issue' | 'returns' | 'damage' | 'transferIn' | 'transferOut' | 'balance' | 'unit'>('itemName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [issueRows, setIssueRows] = useState<StockTransaction[]>([]);
  const [returnRows, setReturnRows] = useState<StockTransaction[]>([]);
  const [damageRows, setDamageRows] = useState<StockTransaction[]>([]);
  const [transferRows, setTransferRows] = useState<StockTransaction[]>([]);

  useEffect(() => {
    fetchFirms().then((data) => {
      setFirms(data);
      setSelectedFirmId(ALL_FIRMS_VALUE);
    });
    fetchStores().then(setStores);
    Promise.all([listIssues(), listReturns(), listDamages(), listTransfers()])
      .then(([issues, returnsList, damages, transfers]) => {
        setIssueRows(issues);
        setReturnRows(returnsList);
        setDamageRows(damages);
        setTransferRows(transfers);
      })
      .catch(() => {
        setIssueRows([]);
        setReturnRows([]);
        setDamageRows([]);
        setTransferRows([]);
      });
  }, []);

  useEffect(() => {
    const firmStores =
      selectedFirmId === ALL_FIRMS_VALUE
        ? stores
        : stores.filter((s) => s.firmId === selectedFirmId);
    if (!firmStores.some((s) => s.id === selectedStoreFilterId)) {
      setSelectedStoreFilterId('');
    }
  }, [selectedFirmId, selectedStoreFilterId, stores]);

  useEffect(() => {
    if (!selectedFirmId) return;
    setLoading(true);
    if (selectedFirmId === ALL_FIRMS_VALUE) {
      Promise.all(firms.map((f) => fetchInventorySheet(f.id)))
	        .then((all) =>
	          setRows(
	            all.flatMap((list, idx) =>
	              list.map((r) => ({
	                ...r,
	                firm: String(firms[idx]?.sortName ?? '').trim() || firms[idx]?.name || '',
	              }))
	            )
	          )
	        )
        .finally(() => setLoading(false));
      return;
    }
	    fetchInventorySheet(selectedFirmId)
	      .then((list) => {
	        const selectedFirm = firms.find((f) => f.id === selectedFirmId);
	        const firmName = selectedFirm ? String(selectedFirm.sortName ?? '').trim() || selectedFirm.name : '';
	        setRows(list.map((r) => ({ ...r, firm: firmName })));
	      })
      .finally(() => setLoading(false));
  }, [selectedFirmId, firms]);

  const adjustedRows = React.useMemo(() => {
    const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const splitStores = (value: unknown) =>
      String(value ?? '')
        .split(',')
        .map((x) => normalize(x))
        .filter(Boolean);
    const resolveFirmId = (rawValue: unknown) => {
      const raw = String(rawValue ?? '').trim();
      if (!raw) return '';
      const byId = firms.find((f) => f.id === raw);
      if (byId) return byId.id;
      const needle = normalize(raw);
      const byName = firms.find((f) => normalize(f.name) === needle || normalize(f.sortName) === needle);
      return byName?.id ?? '';
    };
    const matchesStore = (row: InventorySheetRow, txStore: string) => {
      const wanted = normalize(txStore);
      if (!wanted) return true;
      const rowStores = splitStores(getStoreLabel(row));
      if (!rowStores.length || rowStores.includes('-')) return true;
      return rowStores.includes(wanted);
    };
    const qtyForRow = (tx: StockTransaction, row: InventorySheetRow) =>
      (tx.items ?? [])
        .filter((it) => {
          const txItem = normalize(it.item);
          if (!txItem) return false;
          const rowInline = normalize(getFullSheetItemLabel(row));
          const rowName = normalize(row.itemName);
          return txItem === rowInline || txItem === rowName || txItem.includes(rowName) || rowInline.includes(txItem);
        })
        .reduce((sum, it) => sum + Number(it.quantity ?? 0), 0);

    return rows.map((row) => {
      const rowFirmId = resolveFirmId(getFirmLabel(row));
      let issueDelta = 0;
      let returnDelta = 0;
      let damageDelta = 0;
      let transferOut = 0;
      let transferIn = 0;

      for (const tx of issueRows) {
        if (rowFirmId && resolveFirmId(tx.firmId) !== rowFirmId) continue;
        if (!matchesStore(row, String(tx.store ?? ''))) continue;
        issueDelta += qtyForRow(tx, row);
      }
      for (const tx of returnRows) {
        if (rowFirmId && resolveFirmId(tx.firmId) !== rowFirmId) continue;
        if (!matchesStore(row, String(tx.store ?? ''))) continue;
        returnDelta += qtyForRow(tx, row);
      }
      for (const tx of damageRows) {
        if (rowFirmId && resolveFirmId(tx.firmId) !== rowFirmId) continue;
        if (!matchesStore(row, String(tx.store ?? ''))) continue;
        damageDelta += qtyForRow(tx, row);
      }
      for (const tx of transferRows) {
        if (rowFirmId && resolveFirmId(tx.firmId) === rowFirmId && matchesStore(row, String(tx.store ?? ''))) {
          transferOut += qtyForRow(tx, row);
        }
        if (rowFirmId && resolveFirmId(tx.toFirmId) === rowFirmId && matchesStore(row, String(tx.toStore ?? ''))) {
          transferIn += qtyForRow(tx, row);
        }
      }

      const opening = Number(row.opening ?? 0);
      const purchase = Number(row.purchase ?? 0);
      const issue = Number(row.issue ?? 0) + issueDelta;
      const returns = Number(row.returns ?? 0) + returnDelta;
      const damage = Number(row.damage ?? 0) + damageDelta;
      const balance = opening + purchase + returns + transferIn - issue - damage - transferOut;
      return { ...row, issue, returns, damage, transferIn, transferOut, balance };
    });
  }, [rows, firms, issueRows, returnRows, damageRows, transferRows]);

  const selectedStoreName = stores.find((s) => s.id === selectedStoreFilterId)?.name ?? '';
  const filteredRows = adjustedRows.filter((r) => {
    const bySearch =
      r.itemName.toLowerCase().includes(search.toLowerCase()) ||
      r.itemCode.toLowerCase().includes(search.toLowerCase());

    if (!selectedStoreName) return bySearch;
    const rowStore = getStoreLabel(r).toLowerCase();
    const wanted = selectedStoreName.toLowerCase();
    const byStore = rowStore
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(wanted);
    return bySearch && byStore;
  });
  const sortedRows = [...filteredRows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const strCmp = (x: string, y: string) => x.localeCompare(y);
    switch (sortBy) {
      case 'itemName':
        return dir * strCmp(getFullSheetItemLabel(a), getFullSheetItemLabel(b));
      case 'firm':
        return dir * strCmp(getFirmLabel(a), getFirmLabel(b));
      case 'store':
        return dir * strCmp(getStoreLabel(a), getStoreLabel(b));
      case 'unit':
        return dir * strCmp(String(a.unit ?? ''), String(b.unit ?? ''));
      case 'opening':
      case 'reorderLevel':
      case 'purchase':
      case 'issue':
      case 'returns':
      case 'damage':
      case 'transferIn':
      case 'transferOut':
      case 'balance': {
        const av = Number((a as any)[sortBy] ?? 0);
        const bv = Number((b as any)[sortBy] ?? 0);
        return dir * (av - bv);
      }
      default:
        return 0;
    }
  });

  const filteredStores =
    selectedFirmId === ALL_FIRMS_VALUE
      ? stores
      : stores.filter((s) => s.firmId === selectedFirmId);
  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(selectedStoreFilterId) ||
    selectedFirmId !== ALL_FIRMS_VALUE;
	  const onSort = (key: typeof sortBy) => {
	    if (sortBy === key) {
	      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
	      return;
	    }
	    setSortBy(key);
	    setSortDir('asc');
	  };

	  const exportBaseName = useMemo(() => {
	    const firmLabel =
	      selectedFirmId === ALL_FIRMS_VALUE
	        ? 'AllFirms'
	        : String(firms.find((f) => f.id === selectedFirmId)?.sortName ?? '').trim() ||
	          String(firms.find((f) => f.id === selectedFirmId)?.name ?? '').trim() ||
	          'Firm';
	    const storeLabel = selectedStoreFilterId ? (stores.find((s) => s.id === selectedStoreFilterId)?.name ?? 'Store') : 'AllStores';
	    const date = new Date().toISOString().slice(0, 10);
	    return `Inventory_${firmLabel}_${storeLabel}_${date}`.replace(/[^\w\-]+/g, '_');
	  }, [firms, selectedFirmId, selectedStoreFilterId, stores]);

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

		  const exportInventoryCsv = () => {
		    const headers = [
		      'Item Name',
		      'Firm',
		      'Store',
		      'Opening',
		      'Purchase',
		      'Issue',
		      'Return',
		      'Damage',
		      'Transfer In',
		      'Transfer Out',
		      'Closing Balance',
		      'Re-Order Level',
		      'Unit',
		    ];
	    const esc = (v: unknown) => {
	      const s = String(v ?? '');
	      if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/\"/g, '""')}"`;
	      return s;
	    };
	    const lines = [headers.map(esc).join(',')];
	    for (const r of sortedRows) {
	      lines.push(
		        [
		          getFullSheetItemLabel(r),
		          getFirmLabel(r),
		          getStoreLabel(r),
		          Number(r.opening ?? 0),
		          Number(r.purchase ?? 0),
		          Number(r.issue ?? 0),
		          Number(r.returns ?? 0),
		          Number(r.damage ?? 0),
		          Number((r as any).transferIn ?? 0),
		          Number((r as any).transferOut ?? 0),
		          Number(r.balance ?? 0),
		          Number((r as any).reorderLevel ?? 0),
		          String(r.unit ?? ''),
		        ].map(esc).join(',')
		      );
		    }
	    downloadTextFile(`${exportBaseName}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
	  };

	  const exportInventoryPdf = () => {
	    const title = `${exportBaseName}`.replace(/_/g, ' ');
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
	                <th>Item Name</th>
	                <th>Firm</th>
	                <th>Store</th>
	                <th>Opening</th>
		                <th>Purchase</th>
		                <th>Issue</th>
		                <th>Return</th>
		                <th>Damage</th>
		                <th>Tr In</th>
		                <th>Tr Out</th>
		                <th>Closing</th>
		                <th>Re-Order</th>
		                <th>Unit</th>
		              </tr>
	            </thead>
	            <tbody>
	              ${sortedRows
	                .map((r) => {
		                  const cols = [
		                    `<td>${String(getFullSheetItemLabel(r)).replace(/</g, '&lt;')}</td>`,
		                    `<td>${String(getFirmLabel(r)).replace(/</g, '&lt;')}</td>`,
		                    `<td>${String(getStoreLabel(r)).replace(/</g, '&lt;')}</td>`,
		                    `<td class="num">${Number(r.opening ?? 0)}</td>`,
		                    `<td class="num">${Number(r.purchase ?? 0)}</td>`,
		                    `<td class="num">${Number(r.issue ?? 0)}</td>`,
		                    `<td class="num">${Number(r.returns ?? 0)}</td>`,
		                    `<td class="num">${Number(r.damage ?? 0)}</td>`,
		                    `<td class="num">${Number((r as any).transferIn ?? 0)}</td>`,
		                    `<td class="num">${Number((r as any).transferOut ?? 0)}</td>`,
		                    `<td class="num">${Number(r.balance ?? 0)}</td>`,
		                    `<td class="num">${Number((r as any).reorderLevel ?? 0)}</td>`,
		                    `<td>${String(r.unit ?? '').replace(/</g, '&lt;')}</td>`,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 bg-surface-container-low p-4 rounded-xl border border-outline-variant">
	        <div className="flex items-center gap-4 flex-1">
          <div className="w-64">
            <label className={labelClass}>Select Firm</label>
            <select
              value={selectedFirmId}
              onChange={(e) => setSelectedFirmId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select Firm</option>
              <option value={ALL_FIRMS_VALUE}>All Firms</option>
	              {firms.map(f => <option key={f.id} value={f.id}>{String(f.sortName ?? '').trim() || f.name}</option>)}
            </select>
          </div>
          <div className="flex-1 max-w-sm">
            <label className={labelClass}>Search Items</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
              <input
                type="text"
                placeholder="Name or Code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(inputClass, "pl-9")}
              />
            </div>
          </div>
          <div className="w-64">
            <label className={labelClass}>Store Filter</label>
            <select
              value={selectedStoreFilterId}
              onChange={(e) => setSelectedStoreFilterId(e.target.value)}
              className={inputClass}
              disabled={!selectedFirmId}
            >
              <option value="">All Stores</option>
              {filteredStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
	          <div className="w-40">
	            <label className={labelClass}>&nbsp;</label>
	            <div className="flex items-center gap-2">
	              <button
	                type="button"
	                onClick={() => {
	                  setSelectedFirmId(ALL_FIRMS_VALUE);
	                  setSearch('');
	                  setSelectedStoreFilterId('');
	                }}
	                disabled={!hasActiveFilters}
	                className="flex-1 h-[38px] px-3 rounded-lg border border-error bg-error text-on-primary text-sm font-semibold hover:bg-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		              >
		                Clear
		              </button>
		              <button type="button" className="btn btn-sm h-[38px] px-3" title="Download Excel" onClick={exportInventoryCsv}>
		                Excel
		              </button>
		              <button type="button" className="btn btn-sm h-[38px] px-3" title="Download PDF" onClick={exportInventoryPdf}>
		                Pdf
		              </button>
		            </div>
		          </div>
		        </div>
        <button
          onClick={() => setShowOpeningModal(true)}
          className="flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-dim transition-colors mt-5"
        >
          <Settings size={16} />
          Manage Opening Stock
        </button>
      </div>

	      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low">
          <div className="font-headline font-bold text-sm text-on-surface">Item Sheet (Financial Year: 2024-25)</div>
        </div>
        
	        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 flex justify-center"><Spinner /></div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                <tr>
                  <th className="p-0 border-b border-black border-r border-black">
                    <button type="button" onClick={() => onSort('itemName')} className="w-full px-3 py-3 flex items-center justify-between">
                      <span>Item Name</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black">
                    <button type="button" onClick={() => onSort('firm')} className="w-full px-3 py-3 flex items-center justify-between">
                      <span>Firm</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black">
                    <button type="button" onClick={() => onSort('store')} className="w-full px-3 py-3 flex items-center justify-between">
                      <span>Store</span><ArrowUpDown size={12} />
                    </button>
                  </th>
	                  <th className="p-0 border-b border-black border-r border-black text-right">
	                    <button type="button" onClick={() => onSort('opening')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
	                      <span>Opening</span><ArrowUpDown size={12} />
	                    </button>
	                  </th>
	                  <th className="p-0 border-b border-black border-r border-black text-right">
	                    <button type="button" onClick={() => onSort('purchase')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
	                      <span>Purchase</span><ArrowUpDown size={12} />
	                    </button>
	                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('issue')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Issue</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('returns')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Return</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('damage')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Damage</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('transferIn')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Transfer In</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('transferOut')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Transfer Out</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right font-bold text-primary">
                    <button type="button" onClick={() => onSort('balance')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Closing Balance</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black border-r border-black text-right">
                    <button type="button" onClick={() => onSort('reorderLevel')} className="w-full px-3 py-3 flex items-center justify-end gap-1">
                      <span>Re-Order Level</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="p-0 border-b border-black text-center">
                    <button type="button" onClick={() => onSort('unit')} className="w-full px-3 py-3 flex items-center justify-center gap-1">
                      <span>Unit</span><ArrowUpDown size={12} />
                    </button>
                  </th>
                </tr>
	              </thead>
	              <tbody className="divide-y divide-outline-variant">
	                {filteredRows.length === 0 ? (
	                  <tr>
		                    <td colSpan={13} className="p-8 text-center text-on-surface-variant italic">No items found</td>
		                  </tr>
		                ) : (
			                  sortedRows.map((r, idx) => (
			                    (() => {
			                      const reorderLevel = Number((r as any).reorderLevel ?? 0);
			                      const balance = Number(r.balance ?? 0);
			                      const isLow = reorderLevel > 0 && balance <= reorderLevel;
			                      return (
			                    <tr
			                      key={`${String(getFirmLabel(r) ?? '-')}-${String(r.itemId)}-${String((r as any).storeId ?? getStoreLabel(r) ?? '-')}-${idx}`}
			                      className={cn(
			                        'transition-colors',
			                        isLow ? 'bg-red-200 hover:bg-red-200' : 'hover:bg-surface-container-low/50'
			                      )}
			                    >
	                      <td className="p-3 border-r border-black text-on-surface font-semibold whitespace-normal break-words" title={getFullSheetItemLabel(r)}>
		                        {getFullSheetItemLabel(r)}
		                      </td>
	                      <td className="p-3 border-r border-black text-on-surface-variant">{getFirmLabel(r)}</td>
	                      <td className="p-3 border-r border-black text-on-surface-variant">{getStoreLabel(r)}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{r.opening}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{r.purchase}</td>
	                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{r.issue}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{r.returns}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right text-error">{r.damage}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{Number((r as any).transferIn ?? 0)}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{Number((r as any).transferOut ?? 0)}</td>
		                      <td className="p-3 border-r border-black text-on-surface font-bold text-right text-primary">{r.balance}</td>
		                      <td className="p-3 border-r border-black text-on-surface-variant text-right">{Number((r as any).reorderLevel ?? 0)}</td>
		                      <td className="p-3 text-on-surface-variant text-center">{r.unit || '-'}</td>
	                    </tr>
	                  );
			                })()
			              ))
	                )}
	              </tbody>
		            </table>
		          )}
	        </div>
	        <div className="px-4 py-3 border-t border-outline-variant bg-surface-container-low flex items-center justify-end gap-2">
	          <button type="button" className="btn btn-sm" onClick={exportInventoryCsv} title="Download Excel">
	            Excel
	          </button>
	          <button type="button" className="btn btn-sm" onClick={exportInventoryPdf} title="Download PDF">
	            Pdf
	          </button>
	        </div>
	      </div>

      {showOpeningModal && (
        <OpeningStockModal 
          onClose={() => {
            setShowOpeningModal(false);
            // Refresh main list
            if (selectedFirmId && selectedFirmId !== ALL_FIRMS_VALUE) {
              fetchInventorySheet(selectedFirmId).then(setRows);
            } else if (selectedFirmId === ALL_FIRMS_VALUE) {
              Promise.all(firms.map((f) => fetchInventorySheet(f.id))).then((all) => setRows(all.flat()));
            }
          }} 
          firms={firms}
        />
      )}
    </div>
  );
}

function OpeningStockModal({ onClose, firms }: { onClose: () => void; firms: Firm[] }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [reorderLevels, setReorderLevels] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchStores().then(setStores);
    fetchItems().then(setItems);
  }, []);

  const filteredStores = stores.filter(s => s.firmId === selectedFirmId);

  useEffect(() => {
    if (selectedStoreId) {
      setLoading(true);
      fetchOpeningBalances(selectedStoreId)
        .then(data => {
          const map: Record<string, number> = {};
          const reorderMap: Record<string, number> = {};
          data.forEach(d => {
            map[d.itemId] = d.quantity;
            reorderMap[d.itemId] = Number(d.reorderLevel ?? 0);
          });
          setBalances(map);
          setReorderLevels(reorderMap);
        })
        .finally(() => setLoading(false));
    } else {
      setBalances({});
      setReorderLevels({});
    }
  }, [selectedStoreId]);

  const handleSave = async () => {
    if (!selectedStoreId) return;
    setSaving(true);
    try {
      const payload = Object.entries(balances).map(([itemId, quantity]) => ({
        itemId,
        quantity,
        reorderLevel: Number(reorderLevels[itemId] ?? 0),
      }));
      await saveOpeningBalances(selectedStoreId, '2024-25', payload);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Manage Opening Stock"
      fullScreen
      titleCentered
      titleClassName="text-primary"
      closeButtonLabel="Cancel"
      headerRight={
        <button
          onClick={handleSave}
          disabled={!selectedStoreId || saving}
          className="inline-flex items-center justify-center gap-2 min-w-[96px] h-9 bg-primary text-on-primary px-4 rounded-lg text-sm font-semibold hover:bg-primary-dim transition-colors disabled:opacity-50"
        >
          {saving ? <Spinner size={14} color="white" /> : <Save size={14} />}
          Save
        </button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 bg-surface-container-low p-4 rounded-lg">
          <div>
            <label className={labelClass}>1. Select Firm</label>
            <select
              value={selectedFirmId}
              onChange={(e) => {
                setSelectedFirmId(e.target.value);
                setSelectedStoreId('');
              }}
              className={inputClass}
            >
              <option value="">Select Firm</option>
	              {firms.map(f => <option key={f.id} value={f.id}>{String(f.sortName ?? '').trim() || f.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>2. Select Store</label>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className={inputClass}
              disabled={!selectedFirmId}
            >
              <option value="">Select Store</option>
              {filteredStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {selectedStoreId && (
          <>
            <div className="border border-outline-variant rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-12 flex justify-center"><Spinner /></div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center italic text-on-surface-variant">No items defined in system</div>
            ) : (
              <div>
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-surface-container-high text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="p-3 border-b border-black border-r border-black">Item Details</th>
                      <th className="p-3 border-b border-black border-r border-black text-right w-40">Opening Quantity</th>
                      <th className="p-3 border-b border-black text-right w-40">Re-Order Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="p-3 border-r border-black">
                          <div
                            className="text-sm font-semibold text-on-surface whitespace-normal break-words"
                            title={getFullItemLabel(item)}
                          >
                            {getFullItemLabel(item)}
                          </div>
                        </td>
                        <td className="p-2 border-r border-black">
                          <input
                            type="number"
                            min="0"
                            value={balances[item.id] ?? ''}
                            onChange={(e) => setBalances(prev => ({ ...prev, [item.id]: parseFloat(e.target.value) || 0 }))}
                            className={cn(inputClass, 'text-right')}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min="0"
                            value={reorderLevels[item.id] ?? ''}
                            onChange={(e) => setReorderLevels(prev => ({ ...prev, [item.id]: parseFloat(e.target.value) || 0 }))}
                            className={cn(inputClass, 'text-right')}
                            placeholder="0.00"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}

function getFullItemLabel(item: Item) {
  const name = String(item.itemName ?? '').trim();
  const desc = String(item.description ?? '').trim();
  const specText = formatSpecs(item.specificationsJson);
  const parts = [name, specText, desc].filter(Boolean);
  return parts.join(' - ') || item.itemCode;
}

function formatSpecs(specificationsJson: string) {
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
}

function getFullSheetItemLabel(row: InventorySheetRow) {
  const name = String(row.itemName ?? '').trim();
  const specText = formatSpecs(row.specifications);
  return [name, specText].filter(Boolean).join(' - ') || String(row.itemCode ?? '').trim() || String(row.itemId);
}

function getStoreLabel(row: InventorySheetRow) {
  const direct = String((row as any).store ?? '').trim();
  if (direct) return direct;
  const named = String((row as any).storeName ?? '').trim();
  if (named) return named;
  return '-';
}

function getFirmLabel(row: InventorySheetRow) {
  const direct = String((row as any).firm ?? '').trim();
  if (direct) return direct;
  const named = String((row as any).firmName ?? '').trim();
  if (named) return named;
  return '-';
}
