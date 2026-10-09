import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Trash2, ArrowUpDown, RefreshCw, Calendar } from 'lucide-react';
import { fetchFirms, fetchStores, fetchSpecifications, fetchSpecificationValues, type Firm, type Store } from '@/src/lib/masters';
import { fetchPhysicalStockMaster, deletePhysicalStockEntry, type PhysicalStockRecord } from '@/src/lib/physicalStock';
import { formatItemInline } from '@/src/lib/itemLabel';
import Spinner from '@/src/components/common/Spinner';

export default function PhysicalStockMasterView({ onAdd }: { onAdd?: () => void } = {}) {
  const [records, setRecords] = useState<PhysicalStockRecord[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [specNameMap, setSpecNameMap] = useState<Record<string, string>>({});
  const [specValueMap, setSpecValueMap] = useState<Record<string, string>>({});

  const [search, setSearch] = useState('');
  const [selectedFirmId, setSelectedFirmId] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<'takenOn' | 'firm' | 'store' | 'item' | 'physicalStock' | 'takenBy' | 'verifiedBy'>('takenOn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPhysicalStockMaster({
        firmId: selectedFirmId || undefined,
        storeId: selectedStoreId || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load physical stock records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchFirms(), fetchStores(), fetchSpecifications(), fetchSpecificationValues()])
      .then(([firmList, storeList, specList, specValList]) => {
        setFirms(firmList);
        setStores(storeList);
        setSpecNameMap(Object.fromEntries(specList.map((s) => [s.id, s.name])));
        setSpecValueMap(Object.fromEntries(specValList.map((sv) => [sv.id, sv.value])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadData();
  }, [selectedFirmId, selectedStoreId, fromDate, toDate]);

  const filteredStores = useMemo(() => {
    if (!selectedFirmId) return stores;
    return stores.filter((s) => s.firmId === selectedFirmId);
  }, [selectedFirmId, stores]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;

      const code = (r.itemCode || '').toLowerCase();
      const name = (r.itemName || '').toLowerCase();
      const fullItem = formatItemInline(r.itemName || '', r.specificationsJson, specNameMap, specValueMap).toLowerCase();
      const firm = (r.firmSortName || r.firmName || '').toLowerCase();
      const store = (r.storeName || '').toLowerCase();
      const person = (r.takenBy || '').toLowerCase();
      const remark = (r.remarks || '').toLowerCase();

      return (
        code.includes(q) ||
        name.includes(q) ||
        fullItem.includes(q) ||
        firm.includes(q) ||
        store.includes(q) ||
        person.includes(q) ||
        remark.includes(q)
      );
    });
  }, [records, search, specNameMap, specValueMap]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const strCmp = (x: string, y: string) => x.localeCompare(y);

      switch (sortBy) {
        case 'takenOn':
          return dir * (new Date(a.takenOn).getTime() - new Date(b.takenOn).getTime());
        case 'firm':
          return dir * strCmp(a.firmSortName || a.firmName || '', b.firmSortName || b.firmName || '');
        case 'store':
          return dir * strCmp(a.storeName || '', b.storeName || '');
        case 'item':
          return dir * strCmp(a.itemName || a.itemCode || '', b.itemName || b.itemCode || '');
        case 'physicalStock':
          return dir * (Number(a.physicalStock || 0) - Number(b.physicalStock || 0));
        case 'takenBy':
          return dir * strCmp(a.takenBy || '', b.takenBy || '');
        case 'verifiedBy':
          return dir * strCmp(a.verifiedBy || '', b.verifiedBy || '');
        default:
          return 0;
      }
    });
  }, [filteredRecords, sortBy, sortDir]);

  const onSort = (key: typeof sortBy) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(key);
    setSortDir('asc');
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this physical stock record?')) {
      return;
    }
    setDeletingId(id);
    try {
      await deletePhysicalStockEntry(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete record.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDateTime = (dtStr: string) => {
    if (!dtStr) return '-';
    try {
      const d = new Date(dtStr);
      if (isNaN(d.getTime())) return dtStr;
      return d.toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return dtStr;
    }
  };

  const parseSpecs = (specJson?: string) => {
    if (!specJson) return '';
    try {
      const obj = JSON.parse(specJson);
      if (typeof obj === 'object' && obj !== null) {
        return Object.values(obj).filter(Boolean).join(' | ');
      }
    } catch {}
    return '';
  };

  return (
    <div className="space-y-6 p-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Physical Stock Master</h1>
          <p className="text-xs text-on-surface-variant">Log of all physical stock audits and verifications</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="p-2 border border-border rounded-lg text-on-surface-variant hover:bg-surface-hover transition-colors"
            title="Refresh Data"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus size={18} />
              Add Physical Stock
            </button>
          ) : null}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 bg-surface-card border border-border rounded-xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Search */}
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute left-3 top-2.5 text-on-surface-variant" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, item, store, taken by..."
              className="w-full pl-9 pr-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Firm */}
          <div>
            <select
              value={selectedFirmId}
              onChange={(e) => setSelectedFirmId(e.target.value)}
              className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Firms</option>
              {firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sortName ? f.sortName : f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Store */}
          <div>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All Stores</option>
              {filteredStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-1/2 px-2 py-1.5 bg-surface border border-border rounded-lg text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              title="From Date"
            />
            <span className="text-xs text-on-surface-variant">-</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-1/2 px-2 py-1.5 bg-surface border border-border rounded-lg text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              title="To Date"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      {/* Table */}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center items-center p-12">
            <Spinner size="lg" />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="p-12 text-center text-on-surface-variant text-sm">
            No physical stock records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-hover/50 border-b border-border text-on-surface-variant font-bold uppercase tracking-wider">
                  <th
                    className="p-3 cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('takenOn')}
                  >
                    <div className="flex items-center gap-1">
                      Timestamp / Date
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="p-3 cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('firm')}
                  >
                    <div className="flex items-center gap-1">
                      Firm
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="p-3 cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('store')}
                  >
                    <div className="flex items-center gap-1">
                      Store
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="p-3 cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('item')}
                  >
                    <div className="flex items-center gap-1">
                      Item
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th
                    className="p-3 text-right cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('physicalStock')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Physical Stock
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th className="p-3">Unit</th>
                  <th
                    className="p-3 cursor-pointer select-none hover:text-on-surface"
                    onClick={() => onSort('takenBy')}
                  >
                    <div className="flex items-center gap-1">
                      Taken By
                      <ArrowUpDown size={12} />
                    </div>
                  </th>
                  <th className="p-3 cursor-pointer select-none hover:text-on-surface" onClick={() => onSort('verifiedBy')}>
                    <div className="flex items-center gap-1">Verified By <ArrowUpDown size={12} /></div>
                  </th>
                  <th className="p-3">Photo</th>
                  <th className="p-3">Remarks</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {sortedRecords.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover/30 transition-colors">
                    <td className="p-3 font-medium text-on-surface whitespace-nowrap">
                      {formatDateTime(row.takenOn)}
                    </td>
                    <td className="p-3 text-on-surface">
                      {row.firmSortName || row.firmName || '-'}
                    </td>
                    <td className="p-3 text-on-surface">{row.storeName || '-'}</td>
                    <td className="p-3 text-on-surface font-medium">
                      {formatItemInline(row.itemName || '', row.specificationsJson, specNameMap, specValueMap)}
                    </td>
                    <td className="p-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {Number(row.physicalStock).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                    </td>
                    <td className="p-3 text-on-surface-variant">{row.unit || 'Pcs'}</td>
                    <td className="p-3 font-medium text-on-surface">{row.takenBy || '-'}</td>
                    <td className="p-3 text-on-surface">{row.verifiedBy || '-'}</td>
                    <td className="p-3">{row.photoUrl ? <a href={row.photoUrl} target="_blank" rel="noreferrer" className="text-primary underline font-medium">View</a> : '-'}</td>
                    <td className="p-3 text-on-surface-variant max-w-xs truncate" title={row.remarks || ''}>
                      {row.remarks || '-'}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        disabled={deletingId === row.id}
                        className="p-1 text-error hover:bg-error/10 rounded transition-colors disabled:opacity-50"
                        title="Delete Record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
