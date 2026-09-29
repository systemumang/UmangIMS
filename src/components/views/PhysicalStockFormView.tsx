import React, { useEffect, useMemo, useState } from 'react';
import { fetchFirms, fetchStores, fetchItems, fetchItemNames, fetchSpecifications, fetchSpecificationValues, fetchUsers, type Firm, type Store, type Item, type User } from '@/src/lib/masters';
import { fetchInventorySheet, type InventorySheetRow } from '@/src/lib/inventory';
import { createPhysicalStockEntry } from '@/src/lib/physicalStock';
import { formatItemInline } from '@/src/lib/itemLabel';
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
  const [users, setUsers] = useState<User[]>([]);
  const [itemNameMap, setItemNameMap] = useState<Record<string, string>>({});
  const [specNameMap, setSpecNameMap] = useState<Record<string, string>>({});
  const [specValueMap, setSpecValueMap] = useState<Record<string, string>>({});

  const [selectedFirmId, setSelectedFirmId] = useState<string>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [inventoryRows, setInventoryRows] = useState<InventorySheetRow[]>([]);
  const [loadingInventory, setLoadingInventory] = useState<boolean>(false);

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
    Promise.all([fetchFirms(), fetchStores(), fetchItems(), fetchItemNames(), fetchSpecifications(), fetchSpecificationValues(), fetchUsers()])
      .then(([firmData, storeData, itemData, itemNameData, specData, specValData, userData]) => {
        setFirms(firmData);
        if (firmData.length > 0) {
          setSelectedFirmId(firmData[0].id);
        }
        setStores(storeData);
        setItems(itemData);
        setUsers(userData);

        try {
          const raw = sessionStorage.getItem('ims.currentUser');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.name) {
              const matchedUser = userData.find((u) => u.name === parsed.name || u.id === parsed.id);
              if (matchedUser) {
                setTakenBy(matchedUser.name);
              }
            }
          }
        } catch {}

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

        const svMap: Record<string, string> = {};
        for (const sv of specValData) {
          svMap[sv.id] = sv.value;
          svMap[sv.id.toLowerCase()] = sv.value;
        }
        setSpecValueMap(svMap);
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

  // Load Inventory Sheet rows whenever selectedFirmId changes
  useEffect(() => {
    if (!selectedFirmId) {
      setInventoryRows([]);
      return;
    }
    setLoadingInventory(true);
    fetchInventorySheet(selectedFirmId, undefined, undefined, { includeEmpty: true })
      .then((rows) => setInventoryRows(rows))
      .catch(() => setInventoryRows([]))
      .finally(() => setLoadingInventory(false));
  }, [selectedFirmId]);

  // Selected Store Name
  const selectedStoreObj = stores.find((s) => s.id === selectedStoreId);
  const selectedStoreName = selectedStoreObj?.name ?? '';

  // Filter inventory rows for current store
  const storeInventoryRows = useMemo(() => {
    if (!selectedStoreId || !selectedStoreName) return inventoryRows;
    const targetStore = selectedStoreName.toLowerCase();
    return inventoryRows.filter((r) => {
      const rowStore = String(r.storeName || r.store || '').toLowerCase();
      if (!rowStore) return true;
      return rowStore.split(',').map((s) => s.trim()).includes(targetStore);
    });
  }, [inventoryRows, selectedStoreId, selectedStoreName]);

  // Build Item Options formatted exactly like Inventory View ("Item Name - Spec1: Val1 - Spec2: Val2")
  const itemOptions = useMemo(() => {
    const optionsMap = new Map<string, { value: string; label: string }>();

    // 1. First populate from Store Inventory Rows
    for (const r of storeInventoryRows) {
      const fullLabel = formatItemInline(r.itemName, r.specifications, specNameMap, specValueMap);
      optionsMap.set(String(r.itemId), {
        value: String(r.itemId),
        label: fullLabel,
      });
    }

    // 2. Fall back / append remaining master items
    for (const item of items) {
      if (!optionsMap.has(item.id)) {
        const nameStr = itemNameMap[item.itemNameId] || 'Unknown Item';
        const fullLabel = formatItemInline(nameStr, item.specificationsJson, specNameMap, specValueMap);
        optionsMap.set(item.id, {
          value: item.id,
          label: fullLabel,
        });
      }
    }

    return Array.from(optionsMap.values());
  }, [storeInventoryRows, items, itemNameMap, specNameMap, specValueMap]);

  // Find selected item details from master or inventory sheet
  const selectedItemObj = items.find((i) => i.id === selectedItemId);
  const selectedInventoryRow = storeInventoryRows.find((r) => String(r.itemId) === selectedItemId);

  const formattedSelectedItemLabel = useMemo(() => {
    if (selectedInventoryRow) {
      return formatItemInline(selectedInventoryRow.itemName, selectedInventoryRow.specifications, specNameMap, specValueMap);
    }
    if (selectedItemObj) {
      const nameStr = itemNameMap[selectedItemObj.itemNameId] || 'Unknown Item';
      return formatItemInline(nameStr, selectedItemObj.specificationsJson, specNameMap, specValueMap);
    }
    return '';
  }, [selectedInventoryRow, selectedItemObj, itemNameMap, specNameMap, specValueMap]);

  const selectItemFromRow = (row: InventorySheetRow) => {
    setSelectedItemId(String(row.itemId));
    if (row.physicalStock != null) {
      setPhysicalStock(String(row.physicalStock));
    } else {
      setPhysicalStock('');
    }
  };

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
    <div className="max-w-5xl mx-auto p-6 bg-surface-card rounded-xl border border-border shadow-sm space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
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
        <div className="p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      {successMsg ? (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm flex items-center gap-2">
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
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Select Item <span className="text-error">*</span>
            </label>
            {loadingInventory ? (
              <span className="text-xs text-primary flex items-center gap-1">
                <Spinner size="sm" /> Loading Store Items...
              </span>
            ) : null}
          </div>
          <SearchableSelect
            options={itemOptions}
            value={selectedItemId}
            onChange={(val) => {
              setSelectedItemId(val);
              const inv = storeInventoryRows.find((r) => String(r.itemId) === val);
              if (inv && inv.physicalStock != null) {
                setPhysicalStock(String(inv.physicalStock));
              }
            }}
            placeholder="Search by Item Name, Specification, or Item Code..."
          />
        </div>

        {/* Item Summary Card */}
        {selectedItemObj || selectedInventoryRow ? (
          <div className="p-4 bg-surface border border-border rounded-xl space-y-2 text-xs">
            <div className="font-bold text-sm text-on-surface text-primary">
              {formattedSelectedItemLabel || selectedInventoryRow?.itemName || 'Item Details'}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1 border-t border-border/60">
              <div>
                <span className="text-on-surface-variant font-medium block">Item Code:</span>
                <span className="font-mono text-on-surface">{selectedInventoryRow?.itemCode || selectedItemObj?.itemCode || '-'}</span>
              </div>
              <div>
                <span className="text-on-surface-variant font-medium block">Unit:</span>
                <span className="text-on-surface">{selectedInventoryRow?.unit || selectedItemObj?.unit || 'Pcs'}</span>
              </div>
              <div>
                <span className="text-on-surface-variant font-medium block">System Closing Balance:</span>
                <span className="font-bold text-primary text-sm">
                  {selectedInventoryRow?.balance ?? 0} {selectedInventoryRow?.unit || selectedItemObj?.unit || ''}
                </span>
              </div>
              <div>
                <span className="text-on-surface-variant font-medium block">Last Physical Stock:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {selectedInventoryRow?.physicalStock != null ? `${selectedInventoryRow.physicalStock}` : 'Not recorded'}
                </span>
              </div>
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
              {selectedInventoryRow?.unit || selectedItemObj?.unit ? (
                <span className="absolute right-3 top-2.5 text-xs text-on-surface-variant font-medium pointer-events-none">
                  {selectedInventoryRow?.unit || selectedItemObj?.unit}
                </span>
              ) : null}
            </div>
          </div>

          {/* Taken By */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              Taken By <span className="text-error">*</span>
            </label>
            <select
              value={takenBy}
              onChange={(e) => setTakenBy(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select User</option>
              {users.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
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
