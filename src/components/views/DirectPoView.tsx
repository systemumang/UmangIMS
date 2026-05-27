import React, { useEffect, useMemo, useState } from 'react';
	import SearchableSelect from '@/src/components/common/SearchableSelect';
	import { createDirectPo } from '@/src/lib/purchaseRequests';
	import { fetchInventorySheet } from '@/src/lib/inventory';
import {
  fetchFirms,
  fetchItemNames,
  fetchItems,
	  fetchSpecificationValues,
	  fetchProjects,
	  fetchSpecifications,
  fetchStores,
  fetchSuppliers,
  fetchUsers,
  type Firm,
	  type Item,
	  type ItemName,
	  type Project,
	  type Specification,
	  type SpecificationValue,
	  type Store,
	  type Supplier,
	  type User,
	} from '@/src/lib/masters';
	import { sanitizeDecimalInput, sanitizePercentInput } from '@/src/lib/numberInput';

type Line = {
  itemId: string;
  itemNameId: string;
  specs: Record<string, string>;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxPercent: string;
};

export default function DirectPoView({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const inputClass =
    'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15';

  const [firms, setFirms] = useState<Firm[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemNames, setItemNames] = useState<ItemName[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});

  const [firmId, setFirmId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [supplierId, setSupplierId] = useState('');
  const [poType, setPoType] = useState<'Goods' | 'Services'>('Goods');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [requestedByUserId, setRequestedByUserId] = useState('');
  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableStockByItemId, setAvailableStockByItemId] = useState<Record<string, number>>({});

  const [lines, setLines] = useState<Line[]>([{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFirm = useMemo(() => firms.find((f) => f.id === firmId) ?? null, [firmId, firms]);
  const firmTermsConditions = useMemo(() => String(selectedFirm?.termsConditions ?? '').trim(), [selectedFirm]);

  useEffect(() => {
    const ac = new AbortController();
    fetchFirms(ac.signal).then(setFirms).catch(() => setFirms([]));
    fetchStores(ac.signal).then(setStores).catch(() => setStores([]));
    fetchProjects(ac.signal).then(setProjects).catch(() => setProjects([]));
    fetchItems(ac.signal).then(setItems).catch(() => setItems([]));
    fetchItemNames(ac.signal).then(setItemNames).catch(() => setItemNames([]));
    fetchSuppliers(ac.signal).then(setSuppliers).catch(() => setSuppliers([]));
    fetchUsers(ac.signal).then(setUsers).catch(() => setUsers([]));
    fetchSpecifications(ac.signal).then(setSpecs).catch(() => setSpecs([]));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (poType === 'Services' && storeId) setStoreId('');
  }, [poType, storeId]);

  useEffect(() => {
    if (!firmId) {
      setStoreId('');
      return;
    }
    const storeOk = stores.some((s) => s.id === storeId && s.firmId === firmId);
    if (!storeOk) setStoreId('');
  }, [firmId, storeId, stores]);

  useEffect(() => {
    if (!supplierId) return;
    const s = suppliers.find((x) => x.id === supplierId);
    const next = String(s?.paymentTerms ?? '').trim();
    if (next) setPaymentTerms(next);
  }, [supplierId, suppliers]);

  useEffect(() => {
    if (!firmId) {
      setAvailableStockByItemId({});
      return;
    }
    const ac = new AbortController();
    fetchInventorySheet(firmId, undefined, ac.signal, { includeEmpty: true })
      .then((rows) => {
        const byItem: Record<string, number> = {};
        for (const r of rows ?? []) {
          const itemId = String(r.itemId ?? '').trim();
          if (!itemId) continue;
          byItem[itemId] = (byItem[itemId] ?? 0) + Number(r.balance ?? 0);
        }
        setAvailableStockByItemId(byItem);
      })
      .catch(() => setAvailableStockByItemId({}));
    return () => ac.abort();
  }, [firmId]);

  const firmOptions = useMemo(
    () =>
      firms
        .slice()
        .sort((a, b) => (String(a.sortName ?? '').trim() || a.name).localeCompare(String(b.sortName ?? '').trim() || b.name))
        .map((f) => {
          const short = String(f.sortName ?? '').trim();
          return { value: f.id, label: short ? `${f.name} (${short})` : f.name };
        }),
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

  const itemOptions = useMemo(
    () =>
      itemNames
        .filter((n) => (n.type ?? 'Goods') === poType)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((it) => ({ value: it.id, label: it.name })),
    [itemNames, poType]
  );

  function getItemNameSpecIds(itemNameId: string): string[] {
    const row = itemNames.find((n) => n.id === itemNameId);
    const ids = Array.isArray((row as any)?.specificationIds) ? ((row as any).specificationIds as any[]).map((x) => String(x)) : [];
    return ids.filter(Boolean);
  }

  const specValueKey = (itemNameId: string, specificationId: string) => `${itemNameId}::${specificationId}`;

  const parseSpecObject = (specificationsJson: string) => {
    try {
      const parsed = JSON.parse(specificationsJson || '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const resolveSelectedItem = (itemNameId: string, specValues: Record<string, string>) => {
    if (!itemNameId) return null;
    const specIds = getItemNameSpecIds(itemNameId);
    const candidates = items.filter((it) => it.itemNameId === itemNameId);
    if (!candidates.length) return null;
    if (!specIds.length) return candidates[0] ?? null;
    if (specIds.some((specId) => !String(specValues?.[specId] ?? '').trim())) return null;
    return (
      candidates.find((it) => {
        const saved = parseSpecObject(it.specificationsJson);
        return specIds.every((specId) => String(saved[specId] ?? '').trim() === String(specValues?.[specId] ?? '').trim());
      }) ?? null
    );
  };

  const canSave = useMemo(() => {
    if (!firmId || !supplierId) return false;
      if (!requestedByUserId) return false;
      if (!String(requiredDate ?? '').trim()) return false;
      if (poType === 'Goods' && !storeId && !projectId) return false;
      if (poType === 'Services' && !projectId) return false;
        if (!String(paymentTerms ?? '').trim()) return false;
			    const hasLine = lines.some((l) => {
	          const qtyOk = Number(l.quantity) > 0;
	          const rateOk = Number(l.rate) > 0;
	          if (!qtyOk || !rateOk) return false;
	          if (String(l.itemId ?? '').trim()) return true;
	          const itemNameId = String(l.itemNameId ?? '').trim();
	          if (!itemNameId) return false;
	          const specIds = getItemNameSpecIds(itemNameId);
	          if (!specIds.length) return poType === 'Services';
	          if (specIds.some((sid) => !String(l.specs?.[sid] ?? '').trim())) return false;
	          return true;
	        });
			    return hasLine;
      }, [firmId, projectId, requiredDate, requestedByUserId, storeId, supplierId, paymentTerms, lines, poType]);

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '' }];
    });
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '' }]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const department = 'N/A';
      const requestedBy = String(users.find((u) => u.id === requestedByUserId)?.name ?? '').trim();
      const requiredDateIso = String(requiredDate ?? '').trim();

      if (!requestedBy) throw new Error('Requested By is required.');
      if (!requiredDateIso) throw new Error('Required Date is required.');

	      const picked = lines
	        .filter((l) => (String(l.itemId ?? '').trim() || String(l.itemNameId ?? '').trim()) && Number(l.quantity) > 0 && Number(l.rate) > 0)
	        .map((l) => ({
	          itemId: String(l.itemId ?? '').trim(),
            itemNameId: String(l.itemNameId ?? '').trim(),
            specs: l.specs ?? {},
	          quantity: Number(l.quantity),
	          rate: Number(l.rate),
	          discountPercent: String(l.discountPercent ?? '').trim() ? Number(l.discountPercent) : 0,
	          taxPercent: String(l.taxPercent ?? '').trim() ? Number(l.taxPercent) : 0,
	        }));

		      await createDirectPo({
		        firmId,
		        storeId: storeId ? storeId : null,
		        projectId: projectId ? projectId : null,
            poType,
		        supplierId,
		        department,
		        requestedBy,
		        requiredDate: requiredDateIso,
		          paymentTerms: paymentTerms.trim(),
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

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <label className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">PO Type</div>
              <select
                className={inputClass}
                value={poType}
                onChange={(e) => {
                  const next = (String(e.target.value) === 'Services' ? 'Services' : 'Goods') as 'Goods' | 'Services';
                  setPoType(next);
                  setLines([{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '' }]);
                }}
              >
                <option value="Goods">Goods</option>
                <option value="Services">Services</option>
              </select>
            </label>

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

            {poType === 'Goods' ? <label className="space-y-1">
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
            </label> : null}

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

	            <label className="space-y-1">
	              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Requested By</div>
	              <SearchableSelect
	                value={requestedByUserId}
	                options={users.map((u) => ({ value: u.id, label: u.name }))}
	                onChange={setRequestedByUserId}
	                placeholder="Select user..."
	              />
	            </label>

		            <label className="space-y-1">
		              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Required Date</div>
		              <input className={inputClass} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} type="date" />
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
	                className={inputClass}
	                value={paymentTerms}
	                onChange={(e) => setPaymentTerms(e.target.value)}
	                placeholder="e.g. Advance / 7 days / 30 days"
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
                  <th className="px-3 py-2 border border-outline-variant">Item Name</th>
                  {poType === 'Goods' ? <th className="px-3 py-2 border border-outline-variant">Specifications</th> : null}
                  {poType === 'Goods' ? <th className="px-3 py-2 border border-outline-variant text-right">Available</th> : null}
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
                      <SearchableSelect
                        value={l.itemNameId}
                        options={itemOptions}
                        onChange={(itemNameId) => {
                          const specIdsToLoad = itemNameId ? getItemNameSpecIds(itemNameId) : [];
                          for (const specId of specIdsToLoad) {
                            const key = specValueKey(itemNameId, specId);
                            if ((specValueOptions[key] ?? []).length) continue;
                            fetchSpecificationValues(specId, { itemNameId })
                              .then((vals) => setSpecValueOptions((m) => ({ ...m, [key]: vals })))
                              .catch(() => {});
                          }
                          updateLine(idx, { itemNameId, itemId: '', specs: {} });
                        }}
                        placeholder="Search item name..."
                      />
                    </td>
                    {poType === 'Goods' ? <td className="p-2 border border-outline-variant min-w-[280px]">
                      {l.itemNameId ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {getItemNameSpecIds(l.itemNameId).map((specId) => {
                            const specName = specNameById?.[specId] ?? specId;
                            const value = String(l.specs?.[specId] ?? '');
                            const key = specValueKey(l.itemNameId, specId);
                            const options = (specValueOptions[key] ?? []).map((v) => ({ value: v.value, label: v.value }));
                            if (value && !options.some((opt) => opt.value === value)) options.unshift({ value, label: value });
                            return (
                              <label key={`${idx}-${specId}`} className="space-y-1">
                                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{specName}</div>
                                <SearchableSelect
                                  value={value}
                                  options={options}
                                  placeholder="Select value..."
                                  onChange={(selectedValue) => {
                                    setLines((prev) =>
                                      prev.map((p, i) => {
                                        if (i !== idx) return p;
                                        const nextSpecs = { ...(p.specs ?? {}), [specId]: selectedValue };
                                        const matched = resolveSelectedItem(p.itemNameId, nextSpecs);
                                        return {
                                          ...p,
                                          specs: nextSpecs,
                                          itemId: matched?.id ?? '',
                                        };
                                      })
                                    );
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="min-h-[40px] text-xs whitespace-pre-line px-2 py-2 bg-surface-container-low rounded-lg border border-outline-variant">
                          -
                        </div>
                      )}
                    </td> : null}
                    {poType === 'Goods' ? <td className="p-2 border border-outline-variant text-right w-28">
                      {Number(availableStockByItemId[String(l.itemId ?? '').trim()] ?? 0).toFixed(2)}
                    </td> : null}
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
	                      <select
	                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
	                        value={String(l.taxPercent ?? '')}
	                        onChange={(e) => updateLine(idx, { taxPercent: String(e.target.value ?? '') })}
	                      >
	                        <option value="">Select</option>
	                        <option value="0">0</option>
	                        <option value="5">5</option>
	                        <option value="12">12</option>
	                        <option value="18">18</option>
	                        <option value="28">28</option>
	                      </select>
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
