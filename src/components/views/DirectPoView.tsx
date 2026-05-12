import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { createDirectPo } from '@/src/lib/purchaseRequests';
import {
  fetchFirms,
  fetchItems,
  fetchProjects,
  fetchSpecifications,
  fetchStores,
  fetchSuppliers,
  type Firm,
  type Item,
  type Project,
  type Specification,
  type Store,
  type Supplier,
} from '@/src/lib/masters';
import { sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';

type Line = {
  itemId: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxPercent: string;
};

export default function DirectPoView({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [specs, setSpecs] = useState<Specification[]>([]);

  const [firmId, setFirmId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [supplierId, setSupplierId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');

  const [lines, setLines] = useState<Line[]>([{ itemId: '', quantity: '', rate: '', discountPercent: '', taxPercent: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFirm = useMemo(() => firms.find((f) => f.id === firmId) ?? null, [firmId, firms]);
  const firmTermsConditions = useMemo(() => String(selectedFirm?.termsConditions ?? '').trim(), [selectedFirm]);
  const firmAddress = useMemo(() => String(selectedFirm?.address ?? '').trim(), [selectedFirm]);

  useEffect(() => {
    const ac = new AbortController();
    fetchFirms(ac.signal).then(setFirms).catch(() => setFirms([]));
    fetchStores(ac.signal).then(setStores).catch(() => setStores([]));
    fetchProjects(ac.signal).then(setProjects).catch(() => setProjects([]));
    fetchItems(ac.signal).then(setItems).catch(() => setItems([]));
    fetchSuppliers(ac.signal).then(setSuppliers).catch(() => setSuppliers([]));
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!firmId) {
      setStoreId('');
      return;
    }
    const storeOk = stores.some((s) => s.id === storeId && s.firmId === firmId);
    if (!storeOk) setStoreId('');
  }, [firmId, storeId, stores]);

  useEffect(() => {
    if (!firmId) {
      setShippingAddress('');
      return;
    }
    setShippingAddress(firmAddress);
  }, [firmAddress, firmId]);

  useEffect(() => {
    if (!supplierId) return;
    const s = suppliers.find((x) => x.id === supplierId);
    const next = String(s?.paymentTerms ?? '').trim();
    if (next) setPaymentTerms(next);
  }, [supplierId, suppliers]);

  const firmOptions = useMemo(
    () =>
      firms
        .slice()
        .sort((a, b) => (String(a.sortName ?? '').trim() || a.name).localeCompare(String(b.sortName ?? '').trim() || b.name))
        .map((f) => ({ value: f.id, label: String(f.sortName ?? '').trim() || f.name })),
    [firms]
  );

  const storeOptions = useMemo(() => {
    const list = firmId ? stores.filter((s) => s.firmId === firmId) : stores;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name }));
  }, [firmId, stores]);

  const projectOptions = useMemo(
    () => projects.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name })),
    [projects]
  );

  const supplierOptions = useMemo(
    () => suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  const formatSpecsLines = (specificationsJson: string) => {
    const raw = String(specificationsJson ?? '').trim();
    if (!raw) return [];
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const entries = Object.entries(obj);
      return entries
        .map(([specId, v]) => {
          const value = String(v ?? '').trim();
          if (!value) return '';
          const name = specNameById?.[specId];
          // Never show raw ids in the UI; if the spec name isn't loaded, show only the value.
          return name ? `${name}: ${value}` : value;
        })
        .filter(Boolean);
    } catch {
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  };

  const getFullItemLabel = (item: Item) => {
    const name = String(item.itemName ?? '').trim();
    const desc = String(item.description ?? '').trim();
    const specs = formatSpecsLines(item.specificationsJson);
    const parts = [name, ...specs, desc].filter(Boolean);
    return parts.join(' - ') || item.itemCode;
  };

  const itemOptions = useMemo(
    () => items.slice().sort((a, b) => getFullItemLabel(a).localeCompare(getFullItemLabel(b))).map((it) => ({ value: it.id, label: getFullItemLabel(it) })),
    [items, specNameById]
  );

  const canSave = useMemo(() => {
    if (!firmId || !supplierId) return false;
    if (!storeId && !projectId) return false;
    if (!String(paymentTerms ?? '').trim()) return false;
    const hasLine = lines.some((l) => String(l.itemId ?? '').trim() && Number(l.quantity) > 0 && Number(l.rate) > 0);
    return hasLine;
  }, [firmId, storeId, projectId, supplierId, paymentTerms, lines]);

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [{ itemId: '', quantity: '', rate: '', discountPercent: '', taxPercent: '' }];
    });
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantity: '', rate: '', discountPercent: '', taxPercent: '' }]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const picked = lines
        .filter((l) => String(l.itemId ?? '').trim() && Number(l.quantity) > 0 && Number(l.rate) > 0)
        .map((l) => ({
          itemId: String(l.itemId).trim(),
          quantity: Number(l.quantity),
          rate: Number(l.rate),
          discountPercent: String(l.discountPercent ?? '').trim() ? Number(l.discountPercent) : 0,
          taxPercent: String(l.taxPercent ?? '').trim() ? Number(l.taxPercent) : 0,
        }));

      await createDirectPo({
        firmId,
        storeId: storeId ? storeId : null,
        projectId: projectId ? projectId : null,
        supplierId,
        paymentTerms: paymentTerms.trim(),
        shippingAddress: shippingAddress.trim() || undefined,
        termsConditions: firmTermsConditions || undefined,
        items: picked,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Direct PO</div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" disabled={saving} onClick={onCancel}>
              Back
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={!canSave || saving} onClick={save}>
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error ? (
            <div className="p-3 rounded-lg border border-error/30 bg-error/10 text-error text-sm">{error}</div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <label className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Firm</div>
              <SearchableSelect
                value={firmId}
                options={firmOptions}
                onChange={(v) => {
                  setFirmId(v);
                  setProjectId('');
                  setStoreId('');
                }}
                placeholder="Select firm..."
              />
            </label>

            <label className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Store</div>
              <SearchableSelect
                value={storeId}
                options={storeOptions}
                onChange={(v) => {
                  setStoreId(v);
                  if (v) setProjectId('');
                }}
                placeholder="Select store..."
                disabled={Boolean(projectId)}
              />
            </label>

            <label className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Project</div>
              <SearchableSelect
                value={projectId}
                options={projectOptions}
                onChange={(v) => {
                  setProjectId(v);
                  if (v) setStoreId('');
                }}
                placeholder="Select project..."
                allowClear
                disabled={Boolean(storeId)}
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Supplier</div>
              <SearchableSelect
                value={supplierId}
                options={supplierOptions}
                onChange={(v) => {
                  setSupplierId(v);
                  const s = suppliers.find((x) => x.id === v);
                  const next = String(s?.paymentTerms ?? '').trim();
                  if (next) setPaymentTerms(next);
                }}
                placeholder="Select supplier..."
              />
            </label>

            <label className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Payment Terms</div>
              <input
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. Advance / 7 days / 30 days"
              />
            </label>

            <label className="space-y-1 md:col-span-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Shipping Address</div>
              <textarea
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm min-h-20"
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                placeholder="Shipping address..."
              />
            </label>

          </div>

          <div className="flex items-center justify-between">
            <div className="font-semibold text-on-surface">PO Items</div>
            <button type="button" className="btn btn-sm" onClick={addLine}>
              Add Item
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-outline-variant">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                <tr>
                  <th className="px-3 py-2 border border-outline-variant">Item</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Qty</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Rate</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Disc %</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Tax %</th>
                  <th className="px-3 py-2 border border-outline-variant text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="p-2 border border-outline-variant min-w-[360px]">
                      <SearchableSelect value={l.itemId} options={itemOptions} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Select item..." />
                    </td>
                    <td className="p-2 border border-outline-variant text-right w-28">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
                        value={l.quantity}
                        onChange={(e) => updateLine(idx, { quantity: sanitizeDecimalInput(e.target.value) })}
                        placeholder="0"
                      />
                    </td>
                    <td className="p-2 border border-outline-variant text-right w-28">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
                        value={l.rate}
                        onChange={(e) => updateLine(idx, { rate: sanitizeDecimalInput(e.target.value) })}
                        placeholder="0"
                      />
                    </td>
                    <td className="p-2 border border-outline-variant text-right w-24">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
                        value={l.discountPercent}
                        onChange={(e) => updateLine(idx, { discountPercent: sanitizePercentInput(e.target.value) })}
                        placeholder="0"
                      />
                    </td>
                    <td className="p-2 border border-outline-variant text-right w-24">
                      <input
                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
                        value={l.taxPercent}
                        onChange={(e) => updateLine(idx, { taxPercent: sanitizePercentInput(e.target.value) })}
                        placeholder="0"
                      />
                    </td>
                    <td className="p-2 border border-outline-variant text-right w-24">
                      <button type="button" className="btn btn-sm" onClick={() => removeLine(idx)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-on-surface-variant">
            Note: Direct PO is not linked to any Purchase Request.
          </div>
        </div>
      </div>
    </div>
  );
}
