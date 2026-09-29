import React, { useEffect, useState } from 'react';
import { fetchFirms, fetchStores, fetchItems, fetchItemNames, fetchSpecifications, type Firm, type Store, type Item } from '@/src/lib/masters';
import { createPhysicalStockEntry } from '@/src/lib/physicalStock';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import { Package, ArrowLeft, CheckCircle } from 'lucide-react';

export default function PhysicalStockFormView({
  onSuccess,
  onCancel,
}: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemNameMap, setItemNameMap] = useState<Record<string, string>>({});
  const [specNameMap, setSpecNameMap] = useState<Record<string, string>>({});

  const [selectedFirmId, setSelectedFirmId] = useState<string>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [physicalStock, setPhysicalStock] = useState<string>('');
  const [takenBy, setTakenBy] = useState<string>('');
  const [takenOn, setTakenOn] = useState<string>(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [remarks, setRemarks] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchFirms(), fetchStores(), fetchItems(), fetchItemNames(), fetchSpecifications()])
      .then(([firmData, storeData, itemData, itemNameData, specData]) => {
        setFirms(firmData);
        if (firmData.length > 0) {
          setSelectedFirmId(firmData[0].id);
        }
        setStores(storeData);
        setItems(itemData);

        const inMap: Record<string, string> = {};
        for (const iname of itemNameData) {
          inMap[iname.id] = iname.name;
        }
        setItemNameMap(inMap);

        const spMap: Record<string, string> = {};
        for (const spec of specData) {
          spMap[spec.id] = spec.name;
        }
        setSpecNameMap(spMap);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load initial data.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredStores = stores.filter((s) => !selectedFirmId || s.firmId === selectedFirmId);

  useEffect(() => {
    if (filteredStores.length > 0) {
      if (!filteredStores.some((s) => s.id === selectedStoreId)) {
        setSelectedStoreId(filteredStores[0].id);
      }
    } else {
      setSelectedStoreId('');
    }
  }, [selectedFirmId, stores]);

  const selectedItemObj = items.find((i) => i.id === selectedItemId);

  const getItemLabel = (item: Item) => {
    const code = item.itemCode ? `[${item.itemCode}] ` : '';
    const name = itemNameMap[item.itemNameId] || 'Unknown Item';
    let specStr = '';
    if (item.specificationsJson) {
      try {
        const parsed = JSON.parse(item.specificationsJson);
        if (typeof parsed === 'object' && parsed !== null) {
          specStr = Object.entries(parsed)
            .map(([k, v]) => `${specNameMap[k] || k}: ${v}`)
            .join(' | ');
        }
      } catch {}
    }
    return `${code}${name}${specStr ? ` (${specStr})` : ''} - Unit: ${item.unit || 'Pcs'}`;
  };

  const itemOptions = items.map((item) => ({
    value: item.id,
    label: getItemLabel(item),
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!selectedFirmId) {
      setError('Please select a firm.');
      return;
    }
    if (!selectedStoreId) {
      setError('Please select a store.');
      return;
    }
    if (!selectedItemId) {
      setError('Please select an item.');
      return;
    }
    const stockVal = parseFloat(physicalStock);
    if (isNaN(stockVal) || stockVal < 0) {
      setError('Please enter a valid physical stock quantity (0 or greater).');
      return;
    }
    if (!takenBy.trim()) {
      setError('Please enter who took the physical stock (Taken By).');
      return;
    }

    setSaving(true);
    try {
      await createPhysicalStockEntry({
        firmId: selectedFirmId,
        storeId: selectedStoreId,
        itemId: selectedItemId,
        physicalStock: stockVal,
        takenBy: takenBy.trim(),
        takenOn: takenOn ? new Date(takenOn).toISOString() : new Date().toISOString(),
        remarks: remarks.trim() || undefined,
      });

      setSuccessMsg('Physical stock recorded successfully!');
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit physical stock.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-surface-card rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between pb-4 mb-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Package size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-on-surface">Physical Stock Entry</h2>
            <p className="text-xs text-on-surface-variant">Record physical count of items in store</p>
          </div>
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-on-surface-variant hover:bg-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Master
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-6 p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      {successMsg ? (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle size={18} />
          {successMsg}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Firm */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Firm <span className="text-error">*</span>
            </label>
            <select
              value={selectedFirmId}
              onChange={(e) => setSelectedFirmId(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select Firm</option>
              {firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.sortName ? `${f.sortName} - ${f.name}` : f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Store */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Store <span className="text-error">*</span>
            </label>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select Store</option>
              {filteredStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Item Selection */}
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
            Select Item <span className="text-error">*</span>
          </label>
          <SearchableSelect
            options={itemOptions}
            value={selectedItemId}
            onChange={(val) => setSelectedItemId(val)}
            placeholder="Search by Item Code, Name, or Specification..."
          />
        </div>

        {selectedItemObj ? (
          <div className="p-3 bg-surface border border-border/60 rounded-lg text-xs space-y-1">
            <div>
              <span className="font-semibold text-on-surface-variant">Item Code:</span>{' '}
              <span className="text-on-surface font-mono">{selectedItemObj.itemCode || '-'}</span>
            </div>
            <div>
              <span className="font-semibold text-on-surface-variant">Item Name:</span>{' '}
              <span className="text-on-surface font-medium">{itemNameMap[selectedItemObj.itemNameId] || '-'}</span>
            </div>
            <div>
              <span className="font-semibold text-on-surface-variant">Unit:</span>{' '}
              <span className="text-on-surface">{selectedItemObj.unit || '-'}</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Physical Stock Quantity */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Physical Stock <span className="text-error">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                value={physicalStock}
                onChange={(e) => setPhysicalStock(e.target.value)}
                placeholder="Enter physical stock"
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
              {selectedItemObj?.unit ? (
                <span className="absolute right-3 top-2.5 text-xs text-on-surface-variant font-medium pointer-events-none">
                  {selectedItemObj.unit}
                </span>
              ) : null}
            </div>
          </div>

          {/* Taken By */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Taken By <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={takenBy}
              onChange={(e) => setTakenBy(e.target.value)}
              placeholder="Person who verified stock"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Taken On (Timestamp) */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Date & Time (Timestamp) <span className="text-error">*</span>
            </label>
            <input
              type="datetime-local"
              value={takenOn}
              onChange={(e) => setTakenOn(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
            Remarks / Notes
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Optional comments or audit notes..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? <Spinner size="sm" /> : null}
            Submit Physical Stock
          </button>
        </div>
      </form>
    </div>
  );
}
