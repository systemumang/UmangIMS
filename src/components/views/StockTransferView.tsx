import React, { useEffect, useMemo, useState } from 'react';
import { fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import { createTransfer } from '@/src/lib/stockMaster';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import { Trash2 } from 'lucide-react';
import {
  fetchDepartments,
  fetchItemNames,
  fetchItems,
  fetchSpecificationValues,
  fetchSpecifications,
  fetchStores,
  fetchUsers,
  type Department,
  type Item,
  type ItemName,
  type Specification,
  type SpecificationValue,
  type Store,
  type User,
} from '@/src/lib/masters';
import { formatSpecsLines } from '@/src/lib/itemLabel';

export default function StockTransferView({
  onCreated,
  onCancel,
}: {
  onCreated: (newId?: string) => void;
  onCancel: () => void;
}) {
  const isAbort = (e: unknown) =>
    e instanceof DOMException && e.name === 'AbortError'
    || String((e as any)?.name ?? '').toLowerCase() === 'aborterror'
    || String((e as any)?.message ?? '').toLowerCase().includes('signal is aborted');

  type ItemDraft = {
    itemId: string;
    itemNameId: string;
    item: string;
    specification: string;
    specs: Record<string, string>;
    quantity: string;
  };

  const [firms, setFirms] = useState<Firm[]>([]);
  const [loadingFirms, setLoadingFirms] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [itemNames, setItemNames] = useState<ItemName[]>([]);
  const [loadingItemNames, setLoadingItemNames] = useState(true);
  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});
  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

  const [fromFirmId, setFromFirmId] = useState('');
  const [fromStoreId, setFromStoreId] = useState('');
  const [fromDepartmentId, setFromDepartmentId] = useState('');
  const [toFirmId, setToFirmId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [toDepartmentId, setToDepartmentId] = useState('');
  const [transferByUserId, setTransferByUserId] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [items, setItems] = useState<ItemDraft[]>([{ itemId: '', itemNameId: '', item: '', specification: '', specs: {}, quantity: '' }]);
  const [itemRowErrors, setItemRowErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingFirms(true);
    fetchFirms(ac.signal)
      .then(setFirms)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingFirms(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingStores(true);
    fetchStores(ac.signal)
      .then(setStores)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingStores(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingDepartments(true);
    fetchDepartments(ac.signal)
      .then(setDepartments)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingDepartments(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingUsers(true);
    fetchUsers(ac.signal)
      .then(setUsers)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingUsers(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingItemNames(true);
    fetchItemNames(ac.signal)
      .then(setItemNames)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingItemNames(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingItems(true);
    fetchItems(ac.signal)
      .then(setMasterItems)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingItems(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchSpecifications(ac.signal)
      .then(setSpecs)
      .catch((e) => {
        if (ac.signal.aborted || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, []);

  const firmOptions = useMemo(
    () => firms.map((f) => ({ value: f.id, label: f.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [firms]
  );
  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [departments]
  );
  const fromStoreOptions = useMemo(
    () => stores.filter((s) => s.firmId === fromFirmId).map((s) => ({ value: s.id, label: s.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [stores, fromFirmId]
  );
  const toStoreOptions = useMemo(
    () => stores.filter((s) => s.firmId === toFirmId).map((s) => ({ value: s.id, label: s.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [stores, toFirmId]
  );
  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [users]
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
    const candidates = masterItems.filter((it) => it.itemNameId === itemNameId);
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

  const fromFirmName = useMemo(() => firms.find((f) => f.id === fromFirmId)?.name ?? fromFirmId, [firms, fromFirmId]);
  const fromStoreName = useMemo(() => stores.find((s) => s.id === fromStoreId)?.name ?? fromStoreId, [stores, fromStoreId]);
  const toFirmName = useMemo(() => firms.find((f) => f.id === toFirmId)?.name ?? toFirmId, [firms, toFirmId]);
  const toStoreName = useMemo(() => stores.find((s) => s.id === toStoreId)?.name ?? toStoreId, [stores, toStoreId]);
  const fromDepartment = useMemo(
    () => departments.find((d) => d.id === fromDepartmentId)?.name ?? fromDepartmentId,
    [departments, fromDepartmentId]
  );
  const toDepartment = useMemo(
    () => departments.find((d) => d.id === toDepartmentId)?.name ?? toDepartmentId,
    [departments, toDepartmentId]
  );
  const transferBy = useMemo(
    () => users.find((u) => u.id === transferByUserId)?.name ?? transferByUserId,
    [users, transferByUserId]
  );

  const computeItems = (rows: ItemDraft[]) => {
    const normalized: Array<{ itemId: string; itemNameId: string; specs: Record<string, string>; item: string; quantity: number }> = [];
    const errors: string[] = [];

    for (const row of rows) {
      const qty = Number.parseFloat(row.quantity || '0');
      const hasAny = Boolean(row.itemNameId.trim() || row.itemId.trim() || row.item.trim() || row.quantity.trim());
      if (!hasAny) continue;

      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push('Please enter Qty > 0 for all selected items.');
        continue;
      }

      const itemNameId = String(row.itemNameId ?? '').trim();
      const itemId = String(row.itemId ?? '').trim();
      if (!itemId) {
        const specIds = itemNameId ? getItemNameSpecIds(itemNameId) : [];
        if (!itemNameId || !specIds.length || specIds.some((sid) => !String(row.specs?.[sid] ?? '').trim())) {
          errors.push('Please select valid item/specification for all filled rows.');
          continue;
        }
      }

      const itemNameLabel = String(row.item ?? '').trim() || String(itemNames.find((n) => n.id === itemNameId)?.name ?? '').trim();
      normalized.push({
        itemId,
        itemNameId,
        specs: row.specs ?? {},
        item: itemNameLabel,
        quantity: qty,
      });
    }

    return { normalized, errors };
  };

  const computed = useMemo(() => computeItems(items), [items]);

  useEffect(() => {
    setItemRowErrors(computed.errors);
  }, [computed.errors]);

  const canSave = useMemo(() => {
    if (!fromFirmId.trim()) return false;
    if (!fromStoreId.trim()) return false;
    if (!fromDepartmentId.trim()) return false;
    if (!toFirmId.trim()) return false;
    if (!toStoreId.trim()) return false;
    if (!toDepartmentId.trim()) return false;
    if (!transferByUserId.trim()) return false;
    if (!transferDate.trim()) return false;
    return computed.normalized.length > 0 && computed.errors.length === 0;
  }, [fromFirmId, fromStoreId, fromDepartmentId, toFirmId, toStoreId, toDepartmentId, transferByUserId, transferDate, computed.normalized.length, computed.errors.length]);

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Stock Transfer</div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
              disabled={saving || !canSave}
              onClick={() => {
                if (saving) return;
                setError(null);
                const { normalized: normalizedItems, errors: rowErrors } = computeItems(items);
                if (!fromFirmId.trim() || !fromStoreId.trim() || !fromDepartmentId.trim() || !toFirmId.trim() || !toStoreId.trim() || !toDepartmentId.trim() || !transferByUserId.trim() || !transferDate.trim()) {
                  setError('Please fill From Firm, From Store, From Department, To Firm, To Store, To Department, Transfer By, and Transfer Date.');
                  return;
                }
                if (!normalizedItems.length || rowErrors.length) {
                  setItemRowErrors(rowErrors);
                  setError('Please add at least one valid item row.');
                  return;
                }

                setSaving(true);
	                createTransfer({
	                  firmId: fromFirmId,
	                  storeId: fromStoreId,
	                  store: fromStoreName,
	                  department: fromDepartment,
	                  toFirmId: toFirmId,
	                  toStoreId: toStoreId,
	                  toStore: toStoreName,
	                  toDepartment,
	                  person: transferBy,
	                  date: transferDate,
	                  items: normalizedItems.map((it) => ({
	                    itemId: it.itemId,
                      itemNameId: it.itemNameId,
                      specs: it.specs,
	                    item: it.item,
	                    quantity: it.quantity,
	                    specification: '',
	                  })),
	                })
                  .then((row) => onCreated(row.id))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving...' : 'Save Transfer'}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error ? (
            <div className="rounded-lg border border-error/30 bg-error/10 text-error text-sm px-3 py-2">{error}</div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">From Firm</div>
              {loadingFirms ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={fromFirmId} options={firmOptions} onChange={setFromFirmId} placeholder="Search firm..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">From Store</div>
              {loadingStores ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={fromStoreId} options={fromStoreOptions} onChange={setFromStoreId} placeholder="Search store..." disabled={!fromFirmId} />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">From Department</div>
              {loadingDepartments ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect
                  value={fromDepartmentId}
                  options={deptOptions}
                  onChange={setFromDepartmentId}
                  placeholder="Search department..."
                />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transfer By</div>
              {loadingUsers ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={transferByUserId} options={userOptions} onChange={setTransferByUserId} placeholder="Search user..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">To Firm</div>
              {loadingFirms ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={toFirmId} options={firmOptions} onChange={setToFirmId} placeholder="Search firm..." />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">To Store</div>
              {loadingStores ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect value={toStoreId} options={toStoreOptions} onChange={setToStoreId} placeholder="Search store..." disabled={!toFirmId} />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">To Department</div>
              {loadingDepartments ? (
                <div className="mt-2 flex items-center gap-2 text-on-surface-variant text-sm">
                  <Spinner className="h-4 w-4" /> Loading...
                </div>
              ) : (
                <SearchableSelect
                  value={toDepartmentId}
                  options={deptOptions}
                  onChange={setToDepartmentId}
                  placeholder="Search department..."
                />
              )}
            </label>

            <label className="block">
              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transfer Date</div>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full mt-2 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
              />
            </label>
          </div>

	          <div className="rounded-xl border border-outline-variant overflow-hidden">
	            <div className="p-3 bg-surface-container-high text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
	              Items
	            </div>
	            <div className="overflow-x-auto">
	              <table className="w-full text-left border-collapse text-sm border border-outline-variant">
	                <thead className="bg-surface-container-low text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
	                  <tr>
	                    <th className="p-3 border border-outline-variant">Item Name</th>
	                    <th className="p-3 border border-outline-variant">Specifications</th>
	                    <th className="p-3 border border-outline-variant text-right">Qty</th>
	                    <th className="p-3 border border-outline-variant text-right">Action</th>
	                  </tr>
	                </thead>
	                <tbody>
	                  {items.map((row, idx) => (
	                    <tr key={idx} className="hover:bg-surface-container-low/50">
	                      <td className="p-3 min-w-[280px] border border-outline-variant">
	                        {loadingItems ? (
	                          <div className="flex items-center gap-2 text-on-surface-variant text-sm">
	                            <Spinner className="h-4 w-4" /> Loading...
	                          </div>
	                        ) : (
                          <SearchableSelect
                            value={row.itemNameId}
                            options={itemNames.map((it) => ({ value: it.id, label: it.name }))}
                            onChange={(itemNameId) => {
                              const specIdsToLoad = itemNameId ? getItemNameSpecIds(itemNameId) : [];
                              for (const specId of specIdsToLoad) {
                                const key = specValueKey(itemNameId, specId);
                                if ((specValueOptions[key] ?? []).length) continue;
                                fetchSpecificationValues(specId, { itemNameId })
                                  .then((vals) => setSpecValueOptions((m) => ({ ...m, [key]: vals })))
                                  .catch(() => {});
                              }
                              setItems((prev) =>
                                prev.map((p, i) =>
                                  i !== idx
                                    ? p
                                    : {
                                        ...p,
                                        itemNameId,
                                        itemId: '',
                                        item: '',
                                        specification: '',
                                        specs: {},
                                      }
                                )
                              );
                            }}
                            placeholder="Search item name..."
                            allowClear
	                            disabled={loadingItemNames}
	                          />
	                        )}
	                      </td>
	                      <td className="p-3 min-w-[260px] border border-outline-variant">
	                        {row.itemNameId ? (
	                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
	                            {getItemNameSpecIds(row.itemNameId).map((specId) => {
                              const specName = specNameById?.[specId] ?? specId;
                              const value = String(row.specs?.[specId] ?? '');
                              const key = specValueKey(row.itemNameId, specId);
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
                                      setItems((prev) =>
                                        prev.map((p, i) => {
                                          if (i !== idx) return p;
                                          const nextSpecs = { ...(p.specs ?? {}), [specId]: selectedValue };
                                          const matched = resolveSelectedItem(p.itemNameId, nextSpecs);
                                          return {
                                            ...p,
                                            specs: nextSpecs,
                                            itemId: matched?.id ?? '',
                                            item: matched?.itemName ?? '',
                                            specification: matched ? formatSpecsLines(matched.specificationsJson, specNameById).join(', ') : '',
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
	                      </td>
	                      <td className="p-3 text-right w-[120px] border border-outline-variant">
	                        <input
	                          type="number"
	                          min={0}
                          step={0.01}
                          value={row.quantity}
                          onChange={(e) => setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p)))}
                          className="w-28 text-right bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
	                          placeholder="0"
	                        />
	                      </td>
	                      <td className="p-3 text-right w-[90px] border border-outline-variant">
	                        <button
	                          type="button"
	                          className="text-error hover:text-error/80 transition-colors disabled:opacity-50"
                          title="Remove"
                          disabled={items.length === 1}
                          onClick={() => {
                            setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
              <div className="text-xs text-on-surface-variant">
                {itemRowErrors.length ? itemRowErrors[0] : 'Add items to transfer.'}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setItems((prev) => [...prev, { itemId: '', itemNameId: '', item: '', specification: '', specs: {}, quantity: '' }])}
              >
                + Add Row
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
