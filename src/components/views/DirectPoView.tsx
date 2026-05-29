import React, { useEffect, useMemo, useState } from 'react';
		import SearchableSelect from '@/src/components/common/SearchableSelect';
    import SupplierCreateModal from '@/src/components/common/SupplierCreateModal';
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

function normalizeAreaUnitName(unitName: string) {
  const u = String(unitName ?? '').trim().toLowerCase();
  if (['sqft', 'sq.ft.', 'sq.ft', 'square feet', 'sq ft'].includes(u)) return 'sqft' as const;
  if (['sqm', 'sq.m.', 'sq.m', 'square meter', 'sq mtr', 'sq m'].includes(u)) return 'sqm' as const;
  return null;
}
function baseDimUnitForAreaUnit(areaUnit: 'sqft' | 'sqm' | null) {
  if (areaUnit === 'sqft') return 'ft';
  if (areaUnit === 'sqm') return 'm';
  return '';
}
function computeAreaQty(length: number, breadth: number, pcs: number) {
  const l = Math.round((length + Number.EPSILON) * 100) / 100;
  const b = Math.round((breadth + Number.EPSILON) * 100) / 100;
  const p = Math.trunc(pcs);
  if (l > 0 && b > 0 && p > 0) return Math.round((l * b * p + Number.EPSILON) * 100) / 100;
  return 0;
}
function getConvertedDim(val: string, from: 'ft' | 'm' | '') {
  const n = Number(val);
  if (!n || n <= 0) return '';
  if (from === 'ft') return `${(n * 0.3048).toFixed(3)} m`;
  if (from === 'm') return `${(n / 0.3048).toFixed(2)} ft`;
  return '';
}
function getConvertedArea(val: string, from: 'sqft' | 'sqm' | null) {
  const n = Number(val);
  if (!n || n <= 0) return '';
  if (from === 'sqft') return `${(n * 0.092903).toFixed(3)} sqm`;
  if (from === 'sqm') return `${(n / 0.092903).toFixed(2)} sqft`;
  return '';
}

type Line = {
  itemId: string;
  itemNameId: string;
  specs: Record<string, string>;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxPercent: string;
  unit: string;
  length: string;
  breadth: string;
  pcs: string;
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
  const [remarks, setRemarks] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [requestedByUserId, setRequestedByUserId] = useState('');
  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableStockByItemId, setAvailableStockByItemId] = useState<Record<string, number>>({});

  const [lines, setLines] = useState<Line[]>([{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '', unit: '', length: '', breadth: '', pcs: '1' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

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
    if (!firmId) {
      setProjectId('');
      return;
    }
    const projectOk = projects.some((p) => p.id === projectId && p.firmId === firmId);
    if (!projectOk) setProjectId('');
  }, [firmId, projectId, projects]);

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

  const projectOptions = useMemo(() => {
    const list = firmId ? projects.filter((p) => p.firmId === firmId) : projects;
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.name }));
  }, [firmId, projects]);

  const supplierOptions = useMemo(
    () => suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );

  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  const specColumnIds = useMemo(() => {
    const seen = new Set<string>();
    for (const row of lines) {
      if (!row.itemNameId) continue;
      for (const specId of getItemNameSpecIds(row.itemNameId)) seen.add(specId);
    }
    return Array.from(seen);
  }, [lines, itemNames]);

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
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, ...patch };
      if (patch.itemNameId !== undefined || patch.specs !== undefined) {
        const matched = resolveSelectedItem(next.itemNameId, next.specs);
        next.itemId = matched?.id ?? '';
        next.unit = matched?.unit ?? (itemNames.find(x => x.id === next.itemNameId) as any)?.unit ?? '';
      }
      return next;
    }));
  };

  const removeLine = (idx: number) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '', unit: '', length: '', breadth: '', pcs: '1' }];
    });
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '', unit: '', length: '', breadth: '', pcs: '1' }]);

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
            length: String(l.length).trim() ? Number(l.length) : undefined,
            breadth: String(l.breadth).trim() ? Number(l.breadth) : undefined,
            pcs: String(l.pcs).trim() ? Number(l.pcs) : undefined,
	        }));

		      await createDirectPo({
		        firmId,
		        storeId: storeId ? storeId : null,
		        projectId: projectId ? projectId : null,
            poType,
		        supplierId,
            remarks: remarks.trim() || undefined,
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
                  setLines([{ itemId: '', itemNameId: '', specs: {}, quantity: '', rate: '', discountPercent: '', taxPercent: '', unit: '', length: '', breadth: '', pcs: '1' }]);
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
                    showCreateWhenEmpty
                    alwaysShowCreate
                    allowEmptyCreate
                    closeOnCreate
                    createLabel={(q) => (q ? `+ Add Supplier "${q}"` : '+ Add Supplier')}
                    onCreate={async (label) => {
                      setNewSupplierName(String(label ?? '').trim());
                      setSupplierCreateOpen(true);
                      return null;
                    }}
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
                <label className="space-y-1 md:col-span-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Remarks</div>
                  <textarea
                    className={inputClass}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Enter remarks..."
                    rows={2}
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
              {poType === 'Goods' ? (
                <div className="min-w-[1500px]">
                  <div
                    className="grid gap-0 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-high border-b border-outline-variant"
                    style={{ gridTemplateColumns: `280px repeat(${specColumnIds.length || 1}, 220px) 100px 100px 100px 100px 80px 110px 100px 100px 90px 90px` }}
                  >
                    <div className="px-2 py-2 border-r border-outline-variant">Item Name</div>
                    {(specColumnIds.length ? specColumnIds : ['__no_specs__']).map((specId) => (
                      <div key={`hdr-${specId}`} className="px-2 py-2 border-r border-outline-variant">
                        {specId === '__no_specs__' ? 'Specifications' : specNameById?.[specId] ?? 'Specification'}
                      </div>
                    ))}
                    <div className="px-2 py-2 border-r border-outline-variant">Unit</div>
                    <div className="px-2 py-2 border-r border-outline-variant">Length</div>
                    <div className="px-2 py-2 border-r border-outline-variant">Breadth</div>
                    <div className="px-2 py-2 border-r border-outline-variant">PCs</div>
                    <div className="px-2 py-2 border-r border-outline-variant text-right">Available</div>
                    <div className="px-2 py-2 border-r border-outline-variant text-right">Qty</div>
                    <div className="px-2 py-2 border-r border-outline-variant text-right">Rate</div>
                    <div className="px-2 py-2 border-r border-outline-variant text-right">Disc %</div>
                    <div className="px-2 py-2 border-r border-outline-variant text-right">Tax %</div>
                    <div className="px-2 py-2 text-right">Action</div>
                  </div>

                  {lines.map((l, idx) => {
                    const specIds = l.itemNameId ? getItemNameSpecIds(l.itemNameId) : [];
                    const areaUnit = normalizeAreaUnitName(l.unit);
                    const isAreaUnit = !!areaUnit;
                    const dimUnit = baseDimUnitForAreaUnit(areaUnit);

                    return (
                      <div
                        key={idx}
                        className={['grid gap-0 bg-surface-container-lowest', idx === 0 ? '' : 'border-t border-outline-variant'].join(' ')}
                        style={{ gridTemplateColumns: `280px repeat(${specColumnIds.length || 1}, 220px) 100px 100px 100px 100px 80px 110px 100px 100px 90px 90px` }}
                      >
	                    <div className="p-2 border-r border-outline-variant">
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
                        placeholder={poType === 'Services' ? 'Search service name...' : 'Search item name...'}
                      />
	                    </div>
                        {(specColumnIds.length ? specColumnIds : ['__no_specs__']).map((specId) => {
                          if (specId === '__no_specs__') {
                            return (
                              <div key={`${idx}-spec-empty`} className="px-2 py-2 border-r border-outline-variant text-xs text-on-surface-variant opacity-80">
                                Select Item Name to load specifications.
                              </div>
                            );
                          }
                          const isRequiredForRow = specIds.includes(specId);
                          if (!l.itemNameId || !isRequiredForRow) {
                            return <div key={`${idx}-${specId}`} className="px-2 py-2 border-r border-outline-variant text-xs text-on-surface-variant opacity-60">-</div>;
                          }
                          const value = String(l.specs?.[specId] ?? '');
                          const key = specValueKey(l.itemNameId, specId);
                          const options = (specValueOptions[key] ?? []).map((v) => ({ value: v.value, label: v.value }));
                          if (value && !options.some((opt) => opt.value === value)) options.unshift({ value, label: value });
                          return (
                            <div key={`${idx}-${specId}`} className="p-2 border-r border-outline-variant">
                              <SearchableSelect
                                value={value}
                                options={options}
                                placeholder="Select"
                                onChange={(selectedValue) => {
                                  const nextSpecs = { ...(l.specs ?? {}), [specId]: selectedValue };
                                  updateLine(idx, { specs: nextSpecs });
                                }}
                              />
                            </div>
                          );
                        })}
                      <div className="p-2 border-r border-outline-variant text-xs text-on-surface-variant">
                        {l.unit || '-'}
                      </div>
                      <div className="p-2 border-r border-outline-variant">
                        {isAreaUnit ? (
                          <div className="space-y-1">
                            <input
                              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm"
                              value={l.length}
                              onChange={(e) => {
                                const val = sanitizeDecimalInput(e.target.value);
                                const q = computeAreaQty(Number(val), Number(l.breadth), Number(l.pcs || 1));
                                updateLine(idx, { length: val, quantity: String(q) });
                              }}
                              placeholder={`L (${dimUnit})`}
                            />
                            {(() => {
                              const conv = getConvertedDim(l.length, dimUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium">{conv}</div> : null;
                            })()}
                          </div>
                        ) : '-'}
                      </div>
                      <div className="p-2 border-r border-outline-variant">
                        {isAreaUnit ? (
                          <div className="space-y-1">
                            <input
                              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm"
                              value={l.breadth}
                              onChange={(e) => {
                                const val = sanitizeDecimalInput(e.target.value);
                                const q = computeAreaQty(Number(l.length), Number(val), Number(l.pcs || 1));
                                updateLine(idx, { breadth: val, quantity: String(q) });
                              }}
                              placeholder={`B (${dimUnit})`}
                            />
                            {(() => {
                              const conv = getConvertedDim(l.breadth, dimUnit);
                              return conv ? <div className="text-[10px] text-red-600 font-medium">{conv}</div> : null;
                            })()}
                          </div>
                        ) : '-'}
                      </div>
                      <div className="p-2 border-r border-outline-variant">
                        {isAreaUnit ? (
                          <input
                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm"
                            value={l.pcs}
                            onChange={(e) => {
                              const val = sanitizeDecimalInput(e.target.value);
                              const q = computeAreaQty(Number(l.length), Number(l.breadth), Number(val || 1));
                              updateLine(idx, { pcs: val, quantity: String(q) });
                            }}
                            placeholder="PCs"
                          />
                        ) : '-'}
                      </div>
	                    <div className="p-2 border-r border-outline-variant text-right">
	                      {Number(availableStockByItemId[String(l.itemId ?? '').trim()] ?? 0).toFixed(2)}
	                    </div>
	                    <div className="p-2 border-r border-outline-variant text-right">
                        <div className="space-y-1">
                          <input
                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right disabled:opacity-70"
                            value={l.quantity}
                            onChange={(e) => updateLine(idx, { quantity: sanitizeDecimalInput(e.target.value) })}
                            placeholder="0"
                            disabled={isAreaUnit}
                          />
                          {isAreaUnit ? (() => {
                            const conv = getConvertedArea(l.quantity, areaUnit);
                            return conv ? <div className="text-[10px] text-red-600 font-medium">{conv}</div> : null;
                          })() : null}
                        </div>
	                    </div>
	                    <div className="p-2 border-r border-outline-variant text-right">
	                      <input
	                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
	                        value={l.rate}
                        onChange={(e) => updateLine(idx, { rate: sanitizeDecimalInput(e.target.value) })}
                        placeholder="0"
                      />
	                    </div>
	                    <div className="p-2 border-r border-outline-variant text-right">
	                      <input
	                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2 py-1 text-sm text-right"
	                        value={l.discountPercent}
	                        onChange={(e) => updateLine(idx, { discountPercent: sanitizePercentInput(e.target.value) })}
	                        placeholder="0"
	                      />
	                    </div>
	                    <div className="p-2 border-r border-outline-variant text-right">
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
	                    </div>
	                    <div className="p-2 text-right">
	                      <button type="button" className="btn btn-sm" onClick={() => removeLine(idx)}>
	                        Remove
	                      </button>
	                    </div>
	                  </div>
                    );
                  })}
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
                    <tr>
                      <th className="px-3 py-2 border border-outline-variant">Service Name</th>
                      <th className="px-3 py-2 border border-outline-variant text-right">Qty</th>
                      <th className="px-3 py-2 border border-outline-variant text-right">Rate</th>
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
                            onChange={(itemNameId) => updateLine(idx, { itemNameId, itemId: '', specs: {} })}
                            placeholder="Search service name..."
                          />
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
                          <button type="button" className="btn btn-sm" onClick={() => removeLine(idx)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
	          </div>

          <div className="text-xs text-on-surface-variant">
            Note: Direct PO is not linked to any Purchase Request.
          </div>
        </div>
	      </div>
	      {supplierCreateOpen ? (
	        <SupplierCreateModal
            initialName={newSupplierName}
            onClose={() => setSupplierCreateOpen(false)}
            onCreated={async (supplier) => {
              const fresh = await fetchSuppliers();
              setSuppliers(fresh);
              setSupplierId(supplier.id);
              if (supplier.paymentTerms) setPaymentTerms(String(supplier.paymentTerms).trim());
              setSupplierCreateOpen(false);
            }}
          />
	      ) : null}
	    </div>
	  );
}
