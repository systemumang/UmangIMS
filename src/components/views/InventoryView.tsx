import React, { useEffect, useState } from 'react';
import { Search, Settings, Save, X } from 'lucide-react';
import { fetchFirms, fetchStores, fetchItems, type Firm, type Store, type Item } from '@/src/lib/masters';
import { fetchInventorySheet, fetchOpeningBalances, saveOpeningBalances, type InventorySheetRow } from '@/src/lib/inventory';
import Spinner from '@/src/components/common/Spinner';
import { Modal, inputClass, labelClass } from './queues/shared';

export default function InventoryView() {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<string>('');
  const [rows, setRows] = useState<InventorySheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showOpeningModal, setShowOpeningModal] = useState(false);

  useEffect(() => {
    fetchFirms().then((data) => {
      setFirms(data);
      if (data.length > 0) setSelectedFirmId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedFirmId) return;
    setLoading(true);
    fetchInventorySheet(selectedFirmId)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [selectedFirmId]);

  const filteredRows = rows.filter(r => 
    r.itemName.toLowerCase().includes(search.toLowerCase()) ||
    r.itemCode.toLowerCase().includes(search.toLowerCase())
  );

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
              {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
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
                  <th className="p-3 border-b border-outline-variant">Code</th>
                  <th className="p-3 border-b border-outline-variant">Item Name</th>
                  <th className="p-3 border-b border-outline-variant text-right">Opening</th>
                  <th className="p-3 border-b border-outline-variant text-right">Purchase</th>
                  <th className="p-3 border-b border-outline-variant text-right">Issue</th>
                  <th className="p-3 border-b border-outline-variant text-right">Return</th>
                  <th className="p-3 border-b border-outline-variant text-right">Damage</th>
                  <th className="p-3 border-b border-outline-variant text-right font-bold text-primary">Closing Balance</th>
                  <th className="p-3 border-b border-outline-variant text-center">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-on-surface-variant italic">No items found</td>
                  </tr>
                ) : (
	                  filteredRows.map((r) => (
	                    <tr key={r.itemId} className="hover:bg-surface-container-low/50 transition-colors">
	                      <td className="p-3 text-on-surface-variant font-mono text-xs">{r.itemCode}</td>
	                      <td className="p-3 text-on-surface font-semibold whitespace-normal break-words" title={getFullSheetItemLabel(r)}>
	                        {getFullSheetItemLabel(r)}
	                      </td>
	                      <td className="p-3 text-on-surface-variant text-right">{r.opening}</td>
	                      <td className="p-3 text-on-surface-variant text-right">{r.purchase}</td>
	                      <td className="p-3 text-on-surface-variant text-right">{r.issue}</td>
	                      <td className="p-3 text-on-surface-variant text-right">{r.returns}</td>
                      <td className="p-3 text-on-surface-variant text-right text-error">{r.damage}</td>
                      <td className="p-3 text-on-surface font-bold text-right text-primary">{r.balance}</td>
                      <td className="p-3 text-on-surface-variant text-center">{r.unit || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showOpeningModal && (
        <OpeningStockModal 
          onClose={() => {
            setShowOpeningModal(false);
            // Refresh main list
            if (selectedFirmId) {
              fetchInventorySheet(selectedFirmId).then(setRows);
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
          data.forEach(d => map[d.itemId] = d.quantity);
          setBalances(map);
        })
        .finally(() => setLoading(false));
    } else {
      setBalances({});
    }
  }, [selectedStoreId]);

  const handleSave = async () => {
    if (!selectedStoreId) return;
    setSaving(true);
    try {
      const payload = Object.entries(balances).map(([itemId, quantity]) => ({ itemId, quantity }));
      await saveOpeningBalances(selectedStoreId, '2024-25', payload);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Manage Opening Stock" fullScreen>
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
              {firms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
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
          <div className="border border-outline-variant rounded-lg overflow-hidden flex flex-col h-[50vh]">
            <div className="bg-surface-container-high p-3 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant flex">
              <div className="flex-1">Item Details</div>
              <div className="w-32 text-right pr-4">Opening Quantity</div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
              {loading ? (
                <div className="p-12 flex justify-center"><Spinner /></div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center italic text-on-surface-variant">No items defined in system</div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="p-3 flex items-center hover:bg-surface-container-low/50 transition-colors">
                    <div className="flex-1">
                      <div
                        className="text-sm font-semibold text-on-surface whitespace-normal break-words"
                        title={getFullItemLabel(item)}
                      >
                        {getFullItemLabel(item)}
                      </div>
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        min="0"
                        value={balances[item.id] ?? ''}
                        onChange={(e) => setBalances(prev => ({ ...prev, [item.id]: parseFloat(e.target.value) || 0 }))}
                        className={cn(inputClass, "text-right")}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedStoreId || saving}
            className="flex items-center gap-2 bg-primary text-on-primary px-8 py-2 rounded-lg text-sm font-semibold hover:bg-primary-dim transition-colors disabled:opacity-50"
          >
            {saving ? <Spinner size={16} color="white" /> : <Save size={16} />}
            Save Balances
          </button>
        </div>
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
