import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPurchaseRequest, fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import SearchableSelect from '@/src/components/common/SearchableSelect';
	import {
		  createItem,
		  createItemName,
	  createSpecification,
	  createSpecificationValue,
	  fetchUsers,
	  fetchItemNames,
	  fetchItems,
	  fetchSpecifications,
	  fetchSpecificationValues,
	  type Item,
	  type ItemName,
	  type Specification,
	  type SpecificationValue,
	  type User,
	} from '@/src/lib/masters';

export default function NewPurchaseRequestView({
  onCreated,
  onCancel,
}: {
  onCreated: (newId?: string) => void;
  onCancel: () => void;
}) {
  type ItemDraft = { itemId: string; item: string; quantity: string; specification: string };

  function formatSpecsLines(specificationsJson: string) {
    try {
      const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
      const entries = Object.entries(obj);
      return entries.map(([k, v]) => `${k}: ${String(v ?? '')}`).filter(Boolean);
    } catch {
      return specificationsJson
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  function formatItemInline(itemName: string, specificationsJson: string) {
    const specs = formatSpecsLines(specificationsJson);
    return [itemName, ...specs].join(' - ');
  }

	  const [firms, setFirms] = useState<Firm[]>([]);
	  const [loadingFirms, setLoadingFirms] = useState(true);
	  const [department, setDepartment] = useState('');
	  const [users, setUsers] = useState<User[]>([]);
	  const [loadingUsers, setLoadingUsers] = useState(true);
	  const [requestedByUserId, setRequestedByUserId] = useState('');
	  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10));
	  const [firmId, setFirmId] = useState('');
	  const [items, setItems] = useState<ItemDraft[]>([{ itemId: '', item: '', quantity: '', specification: '' }]);
  const [itemNames, setItemNames] = useState<ItemName[]>([]);
  const [loadingItemNames, setLoadingItemNames] = useState(true);
  const [masterItems, setMasterItems] = useState<Item[]>([]);
  const [loadingMasterItems, setLoadingMasterItems] = useState(true);
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});

  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [createItemRowIndex, setCreateItemRowIndex] = useState<number | null>(null);
  const [newItemItemNameId, setNewItemItemNameId] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemSpecs, setNewItemSpecs] = useState<Array<{ specificationId: string; value: string }>>([{ specificationId: '', value: '' }]);
  const [creatingItem, setCreatingItem] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createItemNameInlineOpen, setCreateItemNameInlineOpen] = useState(false);
  const [createItemNameInlineValue, setCreateItemNameInlineValue] = useState('');
  const [createItemNameInlineBusy, setCreateItemNameInlineBusy] = useState(false);
  const [createItemNameInlineError, setCreateItemNameInlineError] = useState<string | null>(null);

	  const [createSpecInlineIndex, setCreateSpecInlineIndex] = useState<number | null>(null);
	  const [createSpecInlineValue, setCreateSpecInlineValue] = useState('');
	  const [createSpecInlineBusy, setCreateSpecInlineBusy] = useState(false);
	  const [createSpecInlineError, setCreateSpecInlineError] = useState<string | null>(null);

	  const [createValueInlineIndex, setCreateValueInlineIndex] = useState<number | null>(null);
	  const [createValueInlineValue, setCreateValueInlineValue] = useState('');
	  const [createValueInlineBusy, setCreateValueInlineBusy] = useState(false);
	  const [createValueInlineError, setCreateValueInlineError] = useState<string | null>(null);

	  const inputClass =
	    'w-full bg-surface-container-lowest border border-blue-600/40 rounded-lg px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';

		  useEffect(() => {
		    const ac = new AbortController();
		    setLoadingFirms(true);
	    fetchFirms(ac.signal)
      .then((rows) => {
        setFirms(rows);
        setFirmId(rows[0]?.id ?? '');
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingFirms(false));
	    return () => ac.abort();
	  }, []);

		  useEffect(() => {
		    const ac = new AbortController();
		    setLoadingItemNames(true);
		    fetchItemNames(ac.signal)
		      .then((rows) => setItemNames(rows))
	      .catch((e) => {
	        if (ac.signal.aborted) return;
	        if (e instanceof DOMException && e.name === 'AbortError') return;
	        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
	        setError(e instanceof Error ? e.message : String(e));
	      })
		      .finally(() => setLoadingItemNames(false));
		    return () => ac.abort();
		  }, []);

		  useEffect(() => {
		    const ac = new AbortController();
		    setLoadingUsers(true);
		    fetchUsers(ac.signal)
		      .then((rows) => {
		        const next = Array.isArray(rows) ? rows : [];
		        setUsers(next);
		        setRequestedByUserId((prev) => prev || next[0]?.id || '');
		      })
		      .catch((e) => {
		        if (ac.signal.aborted) return;
		        if (e instanceof DOMException && e.name === 'AbortError') return;
		        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
		        setError(e instanceof Error ? e.message : String(e));
		      })
		      .finally(() => setLoadingUsers(false));
		    return () => ac.abort();
		  }, []);

		  useEffect(() => {
		    const ac = new AbortController();
		    setLoadingMasterItems(true);
		    fetchItems(ac.signal)
	      .then((rows) => setMasterItems(rows))
	      .catch((e) => {
	        if (ac.signal.aborted) return;
	        if (e instanceof DOMException && e.name === 'AbortError') return;
	        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
	        setError(e instanceof Error ? e.message : String(e));
	      })
	      .finally(() => setLoadingMasterItems(false));
	    return () => ac.abort();
	  }, []);

	  useEffect(() => {
	    const ac = new AbortController();
	    fetchSpecifications(ac.signal)
	      .then(setSpecs)
	      .catch(() => {});
	    return () => ac.abort();
	  }, []);

		  useEffect(() => {
		    if (!createItemOpen) return;
		    if (!newItemItemNameId) setNewItemItemNameId(itemNames[0]?.id ?? '');
		  }, [createItemOpen, itemNames, newItemItemNameId]);

	      useEffect(() => {
	        if (!createItemOpen) {
	          setCreateItemNameInlineOpen(false);
	          setCreateItemNameInlineValue('');
	          setCreateItemNameInlineBusy(false);
	          setCreateItemNameInlineError(null);
	          setCreateSpecInlineIndex(null);
	          setCreateSpecInlineValue('');
	          setCreateSpecInlineBusy(false);
	          setCreateSpecInlineError(null);
	          setCreateValueInlineIndex(null);
	          setCreateValueInlineValue('');
	          setCreateValueInlineBusy(false);
	          setCreateValueInlineError(null);
	        }
	      }, [createItemOpen]);

			  const canSubmit = useMemo(() => {
			    if (!firmId || !department.trim() || !requestedByUserId.trim() || !requiredDate.trim()) return false;
			    const normalized = items
			      .map((it) => ({
			        item: it.item.trim(),
			        quantity: Number(it.quantity),
	        specification: it.specification.trim(),
				    }))
				    .filter((it) => it.item && Number.isFinite(it.quantity) && it.quantity > 0 && it.specification);
			    return normalized.length > 0;
			  }, [department, firmId, items, requestedByUserId, requiredDate]);

		  const closeCreateItemName = () => {
		    setCreateItemNameInlineOpen(false);
		    setCreateItemNameInlineValue('');
		    setCreateItemNameInlineError(null);
		  };

		  const submitCreateItemName = () => {
		    const v = createItemNameInlineValue.trim();
		    if (!v) {
		      setCreateItemNameInlineError('Please enter Item Name.');
		      return;
		    }
		    if (createItemNameInlineBusy) return;
		    setCreateItemNameInlineBusy(true);
		    setCreateItemNameInlineError(null);
		    createItemName({ name: v, createdBy: 'system' })
		      .then((created) => {
		        const next = created.itemName;
		        if (!next?.id) return;
		        setItemNames((prev) => {
		          if (prev.some((p) => p.id === next.id)) return prev;
		          return [...prev, next].sort((a, b) => a.name.localeCompare(b.name));
		        });
		        setNewItemItemNameId(next.id);
		        closeCreateItemName();
		      })
		      .catch((e) => setCreateItemNameInlineError(e instanceof Error ? e.message : String(e)))
		      .finally(() => setCreateItemNameInlineBusy(false));
		  };

		  const closeCreateSpec = () => {
		    setCreateSpecInlineIndex(null);
		    setCreateSpecInlineValue('');
		    setCreateSpecInlineError(null);
		  };

		  const submitCreateSpec = () => {
		    const idx = createSpecInlineIndex;
		    if (idx == null) return;
		    const v = createSpecInlineValue.trim();
		    if (!v) {
		      setCreateSpecInlineError('Please enter Specification.');
		      return;
		    }
		    if (createSpecInlineBusy) return;
		    setCreateSpecInlineBusy(true);
		    setCreateSpecInlineError(null);
		    createSpecification({ name: v, createdBy: 'system' })
		      .then((created) => {
		        const next = created.specification;
		        if (!next?.id) return;
		        setSpecs((prev) => {
		          if (prev.some((p) => p.id === next.id)) return prev;
		          return [...prev, next].sort((a, b) => a.name.localeCompare(b.name));
		        });
		        setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, specificationId: next.id, value: '' } : p)));
		        fetchSpecificationValues(next.id)
		          .then((vals) => setSpecValueOptions((m) => ({ ...m, [next.id]: vals })))
		          .catch(() => {});
		        closeCreateSpec();
		      })
		      .catch((e) => setCreateSpecInlineError(e instanceof Error ? e.message : String(e)))
		      .finally(() => setCreateSpecInlineBusy(false));
		  };

		  const closeCreateValue = () => {
		    setCreateValueInlineIndex(null);
		    setCreateValueInlineValue('');
		    setCreateValueInlineError(null);
		  };

		  const submitCreateValue = () => {
		    const idx = createValueInlineIndex;
		    if (idx == null) return;
		    const specId = newItemSpecs[idx]?.specificationId ?? '';
		    if (!specId.trim()) {
		      setCreateValueInlineError('Select specification first.');
		      return;
		    }
		    const v = createValueInlineValue.trim();
		    if (!v) {
		      setCreateValueInlineError('Please enter Value.');
		      return;
		    }
		    if (createValueInlineBusy) return;
		    setCreateValueInlineBusy(true);
		    setCreateValueInlineError(null);
		    createSpecificationValue({ specificationId: specId, value: v, createdBy: 'system' })
		      .then((created) => {
		        const next = created.specificationValue;
		        const finalValue = next?.value ?? v;
		        setSpecValueOptions((m) => {
		          const prev = m[specId] ?? [];
		          if (prev.some((p) => p.value === finalValue)) return m;
		          if (next) return { ...m, [specId]: [...prev, next] };
		          return {
		            ...m,
		            [specId]: [...prev, { id: `NEW-${Date.now()}-${Math.random()}`, specificationId: specId, value: finalValue, isActive: true }],
		          };
		        });
		        setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, value: finalValue } : p)));
		        closeCreateValue();
		      })
		      .catch(() => {
		        setSpecValueOptions((m) => {
		          const prev = m[specId] ?? [];
		          if (prev.some((p) => p.value === v)) return m;
		          return {
		            ...m,
		            [specId]: [...prev, { id: `NEW-${Date.now()}-${Math.random()}`, specificationId: specId, value: v, isActive: true }],
		          };
		        });
		        setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, value: v } : p)));
		        closeCreateValue();
		      })
		      .finally(() => setCreateValueInlineBusy(false));
		  };

	  return (
	    <div className="bg-surface-container-lowest rounded-2xl border border-blue-600/25 p-6 shadow-[0_14px_40px_-28px_rgba(0,0,0,0.35)] space-y-5">
	      <div>
        <h3 className="font-headline font-bold text-base text-on-surface">New Purchase Requisition (PR)</h3>
        <p className="text-sm text-on-surface-variant">Create PR without any rate (rates start from PO stage).</p>
      </div>

      {error ? (
        <div className="bg-error-container/40 rounded-xl border border-outline-variant/5 p-3 text-sm text-on-surface">
          {error}
        </div>
      ) : null}

	      <div className="rounded-2xl border border-blue-600/20 bg-surface-container-low p-4 shadow-sm">
	        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm</div>
	            <SearchableSelect
	              value={firmId}
	              options={firms.map((f) => ({ value: f.id, label: f.name }))}
              onChange={setFirmId}
              disabled={loadingFirms}
              placeholder="Search firm..."
            />
	          </label>

          <label className="space-y-1">
            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Department</div>
            <input className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Operations" />
          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Requested By</div>
	            <SearchableSelect
	              value={requestedByUserId}
	              options={users.map((u) => ({ value: u.id, label: u.name }))}
	              onChange={setRequestedByUserId}
	              disabled={loadingUsers}
	              placeholder="Select user..."
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Required Date</div>
	            <input className={inputClass} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} type="date" />
	          </label>
	        </div>
	      </div>

			      <div className="bg-surface-container-low rounded-2xl border border-blue-600/20 p-4 shadow-sm space-y-3">
			        <div className="flex items-center justify-between">
			          <div>
			            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
			            <div className="text-xs text-on-surface-variant">Select item (specifications are shown under item).</div>
			          </div>
			        </div>

				        <div className="rounded-lg border border-blue-600 overflow-hidden">
				          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-high border-b border-blue-600">
				            <div className="md:col-span-9 px-3 py-2 md:border-r md:border-blue-600">Item</div>
				            <div className="md:col-span-2 px-3 py-2 md:border-r md:border-blue-600">Qty</div>
				            <div className="md:col-span-1 px-3 py-2 text-right">Action</div>
				          </div>

				          {items.map((row, idx) => (
				            <div
				              key={idx}
				              className={[
				                'grid grid-cols-1 md:grid-cols-12 gap-0 bg-surface-container-lowest',
				                idx === 0 ? '' : 'border-t border-blue-600',
				              ].join(' ')}
				            >
			              <div className="md:col-span-9 px-3 py-3 md:border-r md:border-blue-600 space-y-2">
			                <SearchableSelect
			                  value={row.itemId}
			                  options={masterItems.map((it) => ({ value: it.id, label: formatItemInline(it.itemName, it.specificationsJson) }))}
			                  onChange={(id) => {
		                    const found = masterItems.find((it) => it.id === id);
		                    setItems((prev) =>
		                      prev.map((p, i) => {
		                        if (i !== idx) return p;
		                        if (!found) return { ...p, itemId: id, item: '', specification: '' };
		                        return {
		                          ...p,
		                          itemId: id,
		                          item: found.itemName,
		                          specification: formatSpecsLines(found.specificationsJson).join('\n').trim(),
		                        };
		                      })
		                    );
		                  }}
			                  disabled={loadingMasterItems}
			                  placeholder="Search item..."
			                  createLabel={() => `+ Create New Item`}
			                  showCreateWhenEmpty
			                  alwaysShowCreate
			                  allowEmptyCreate
			                  closeOnCreate
		                  onCreate={async (label) => {
		                    const name = label.trim();
		                    setCreateItemRowIndex(idx);
		                    setNewItemUnit('');
		                    setNewItemDescription('');
		                    setNewItemSpecs([{ specificationId: '', value: '' }]);
		                    if (!name) {
		                      setNewItemItemNameId((prev) => prev || itemNames[0]?.id || '');
		                      setCreateItemOpen(true);
		                      return null;
		                    }

		                    try {
		                      const created = await createItemName({ name, createdBy: 'system' });
		                      const next = created.itemName;
		                      if (next?.id) {
		                        setItemNames((prev) => {
		                          if (prev.some((p) => p.id === next.id)) return prev;
		                          return [...prev, next].sort((a, b) => a.name.localeCompare(b.name));
		                        });
		                        setNewItemItemNameId(next.id);
		                      }
		                    } catch (e) {
		                      setError(e instanceof Error ? e.message : String(e));
		                    }

		                    setNewItemUnit('');
		                    setNewItemDescription('');
		                    setCreateItemOpen(true);
		                    return null;
		                  }}
		                />
		              </div>
			              <div className="md:col-span-2 px-3 py-3 md:border-r md:border-blue-600">
			                <input
			                  className={inputClass}
		                  placeholder="Qty"
		                  inputMode="numeric"
		                  value={row.quantity}
		                  onChange={(e) =>
		                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p)))
		                  }
			                />
			              </div>
				              <div className="md:col-span-1 px-3 py-3 flex md:justify-end">
			                <button
		                  type="button"
		                  className="px-3 py-2 text-xs font-semibold text-on-surface-variant border border-blue-600/30 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
		                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
		                  disabled={items.length === 1}
	                  title={items.length === 1 ? 'At least one item required' : 'Remove item'}
	                >
				              Delete
				            </button>
				          </div>
				            </div>
				          ))}
					          <div className="border-t border-blue-600 bg-surface-container-lowest px-3 py-2 flex items-center justify-between gap-3">
						            <div className="flex items-center gap-3">
						              <button
						                type="button"
						                className="px-4 py-2 text-xs font-semibold text-on-primary bg-secondary hover:bg-secondary/90 rounded-lg transition-colors shadow-sm"
						                onClick={() => setItems((prev) => [...prev, { itemId: '', item: '', quantity: '', specification: '' }])}
						              >
						                + Add Item
						              </button>
					            </div>

						            <div className="flex items-center gap-2">
						              <button
						                type="button"
					                onClick={onCancel}
					                className="px-4 py-2 text-xs font-semibold text-on-surface bg-surface-container-high hover:bg-surface-container-highest rounded-lg transition-colors shadow-sm"
					              >
					                Cancel
					              </button>
				              <button
				                type="button"
				                onClick={() => {
				                  if (saving) return;
					                  setError(null);
					                  const normalizedItems = items
					                    .map((it) => ({
					                      item: it.item.trim(),
					                      quantity: Number(it.quantity),
					                      specification: it.specification.trim(),
					                    }))
					                    .filter((it) => it.item && Number.isFinite(it.quantity) && it.quantity > 0 && it.specification);

					                  const requestedBy = users.find((u) => u.id === requestedByUserId)?.name ?? '';
					                  if (!firmId || !department.trim() || !requestedBy.trim() || !requiredDate.trim() || !normalizedItems.length) {
					                    setError('Please fill Firm, Department, Requested By, Required Date, and at least one valid item.');
					                    return;
					                  }

				                  setSaving(true);
					                  createPurchaseRequest({
					                    firmId,
					                    department,
					                    requestedBy,
					                    requiredDate,
					                    items: normalizedItems,
					                  })
				                    .then((created) => onCreated(created.pr.id))
				                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
				                    .finally(() => setSaving(false));
				                }}
					                className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors shadow-sm disabled:opacity-50"
					                disabled={saving || !canSubmit}
					              >
					                {saving ? 'Creating...' : 'Create'}
					              </button>
				            </div>
				          </div>
				        </div>
	      </div>

		      {createItemOpen ? (
		        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
		          <button
		            type="button"
		            className="absolute inset-0 bg-black/40"
		            aria-label="Close"
	            onClick={() => {
	              setCreateItemOpen(false);
	              setCreateItemRowIndex(null);
	            }}
	          />
			          <div className="relative w-full max-w-3xl bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl max-h-[85vh] overflow-auto">
		            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
		              <div className="text-sm font-bold text-on-surface">Create Item</div>
		              <button
		                type="button"
	                className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                onClick={() => {
	                  setCreateItemOpen(false);
	                  setCreateItemRowIndex(null);
	                }}
	              >
	                Close
		              </button>
		            </div>

			            <div className="p-5 space-y-3">
			              {error ? (
			                <div className="bg-error-container/30 rounded-xl border border-outline-variant/10 p-3 text-sm text-on-surface">
			                  {error}
			                </div>
			              ) : null}

			              {createItemNameInlineOpen
			                ? createPortal(
			                    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
			                      <button
			                        type="button"
			                        className="absolute inset-0 bg-black/40"
			                        aria-label="Close"
			                        onClick={closeCreateItemName}
			                      />
			                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl">
			                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
			                          <div className="text-sm font-bold text-on-surface">Create new Item Name</div>
			                          <button
			                            type="button"
			                            className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                            onClick={closeCreateItemName}
			                          >
			                            Close
			                          </button>
			                        </div>
			                        <div className="p-5 space-y-3">
			                          {createItemNameInlineError ? (
			                            <div className="text-xs text-error">{createItemNameInlineError}</div>
			                          ) : null}
			                          <input
			                            className={inputClass}
			                            autoFocus
			                            value={createItemNameInlineValue}
			                            placeholder="Enter new item name"
			                            onChange={(e) => setCreateItemNameInlineValue(e.target.value)}
			                            onKeyDown={(e) => {
			                              if (e.key === 'Escape') closeCreateItemName();
			                              if (e.key === 'Enter') submitCreateItemName();
			                            }}
			                          />
			                          <div className="flex justify-end gap-2">
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                              onClick={closeCreateItemName}
			                            >
			                              Cancel
			                            </button>
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                              disabled={createItemNameInlineBusy || !createItemNameInlineValue.trim()}
			                              onClick={submitCreateItemName}
			                            >
			                              {createItemNameInlineBusy ? 'Creating...' : 'Create'}
			                            </button>
			                          </div>
			                        </div>
			                      </div>
			                    </div>,
			                    document.body
			                  )
			                : null}

			              {createSpecInlineIndex != null
			                ? createPortal(
			                    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
			                      <button
			                        type="button"
			                        className="absolute inset-0 bg-black/40"
			                        aria-label="Close"
			                        onClick={closeCreateSpec}
			                      />
			                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl">
			                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
			                          <div className="text-sm font-bold text-on-surface">Create new Specification</div>
			                          <button
			                            type="button"
			                            className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                            onClick={closeCreateSpec}
			                          >
			                            Close
			                          </button>
			                        </div>
			                        <div className="p-5 space-y-3">
			                          {createSpecInlineError ? <div className="text-xs text-error">{createSpecInlineError}</div> : null}
			                          <input
			                            className={inputClass}
			                            autoFocus
			                            value={createSpecInlineValue}
			                            placeholder="Enter new specification"
			                            onChange={(e) => setCreateSpecInlineValue(e.target.value)}
			                            onKeyDown={(e) => {
			                              if (e.key === 'Escape') closeCreateSpec();
			                              if (e.key === 'Enter') submitCreateSpec();
			                            }}
			                          />
			                          <div className="flex justify-end gap-2">
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                              onClick={closeCreateSpec}
			                            >
			                              Cancel
			                            </button>
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                              disabled={createSpecInlineBusy || !createSpecInlineValue.trim()}
			                              onClick={submitCreateSpec}
			                            >
			                              {createSpecInlineBusy ? 'Creating...' : 'Create'}
			                            </button>
			                          </div>
			                        </div>
			                      </div>
			                    </div>,
			                    document.body
			                  )
			                : null}

			              {createValueInlineIndex != null
			                ? createPortal(
			                    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
			                      <button
			                        type="button"
			                        className="absolute inset-0 bg-black/40"
			                        aria-label="Close"
			                        onClick={closeCreateValue}
			                      />
			                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl">
			                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
			                          <div className="text-sm font-bold text-on-surface">Add new Value</div>
			                          <button
			                            type="button"
			                            className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                            onClick={closeCreateValue}
			                          >
			                            Close
			                          </button>
			                        </div>
			                        <div className="p-5 space-y-3">
			                          {createValueInlineError ? <div className="text-xs text-error">{createValueInlineError}</div> : null}
			                          <input
			                            className={inputClass}
			                            autoFocus
			                            value={createValueInlineValue}
			                            placeholder="Enter new value"
			                            onChange={(e) => setCreateValueInlineValue(e.target.value)}
			                            onKeyDown={(e) => {
			                              if (e.key === 'Escape') closeCreateValue();
			                              if (e.key === 'Enter') submitCreateValue();
			                            }}
			                          />
			                          <div className="flex justify-end gap-2">
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                              onClick={closeCreateValue}
			                            >
			                              Cancel
			                            </button>
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                              disabled={createValueInlineBusy || !createValueInlineValue.trim()}
			                              onClick={submitCreateValue}
			                            >
			                              {createValueInlineBusy ? 'Creating...' : 'Create'}
			                            </button>
			                          </div>
			                        </div>
			                      </div>
			                    </div>,
			                    document.body
			                  )
			                : null}
			              <label className="space-y-1">
			                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Name</div>
			                <SearchableSelect
			                  value={newItemItemNameId}
			                  options={itemNames.map((n) => ({ value: n.id, label: n.name }))}
		                  onChange={setNewItemItemNameId}
		                  placeholder="Search item name..."
		                  showCreateWhenEmpty
		                  allowEmptyCreate
		                  closeOnCreate
		                  createLabel={(q) => (q ? `+ Create Item Name "${q}"` : '+ Create Item Name')}
		                  onCreate={async (label) => {
			                    setCreateItemNameInlineError(null);
			                    setCreateItemNameInlineValue(label.trim());
			                    setCreateItemNameInlineOpen(true);
			                    return null;
			                  }}
			                />
			              </label>

		              <label className="space-y-1">
		                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit (optional)</div>
		                <input
		                  className={inputClass}
		                  value={newItemUnit}
		                  onChange={(e) => setNewItemUnit(e.target.value)}
		                  placeholder="Nos"
		                />
		              </label>

		              <label className="space-y-1">
		                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description (optional)</div>
		                <input
		                  className={inputClass}
		                  value={newItemDescription}
		                  onChange={(e) => setNewItemDescription(e.target.value)}
		                  placeholder="High tensile"
		                />
		              </label>

	              <div className="space-y-2">
	                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specifications</div>
		                {newItemSpecs.map((row, sIdx) => (
		                  <div key={sIdx} className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-3 space-y-2">
	                    <div className="flex items-center justify-between gap-2">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Spec Row {sIdx + 1}</div>
	                      <button
	                        type="button"
	                        className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-50"
	                        disabled={newItemSpecs.length === 1}
	                        onClick={() => setNewItemSpecs((prev) => prev.filter((_, i) => i !== sIdx))}
	                      >
	                        Remove
	                      </button>
	                    </div>

			                    <label className="space-y-1">
			                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Spec</div>
				                      <SearchableSelect
				                        value={row.specificationId}
				                        options={specs.map((s) => ({ value: s.id, label: s.name }))}
			                        onChange={(specId) => {
		                          setNewItemSpecs((prev) => prev.map((p, i) => (i === sIdx ? { ...p, specificationId: specId, value: '' } : p)));
	                          if (!specId) return;
	                          fetchSpecificationValues(specId)
	                            .then((vals) => setSpecValueOptions((m) => ({ ...m, [specId]: vals })))
	                            .catch(() => {});
		                        }}
			                        placeholder="Search specification..."
			                        showCreateWhenEmpty
			                        allowEmptyCreate
			                        closeOnCreate
			                        createLabel={(q) => (q ? `+ Create Specification "${q}"` : '+ Create Specification')}
			                        onCreate={async (label) => {
			                          setCreateSpecInlineError(null);
			                          setCreateSpecInlineIndex(sIdx);
			                          setCreateSpecInlineValue(label.trim());
			                          return null;
			                        }}
			                      />
			                    </label>

	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Value</div>
			                      <SearchableSelect
			                        value={row.value}
		                        options={(() => {
		                          const opts = (specValueOptions[row.specificationId] ?? []).map((v) => ({ value: v.value, label: v.value }));
		                          if (row.value && !opts.some((o) => o.value === row.value)) return [{ value: row.value, label: row.value }, ...opts];
		                          return opts;
		                        })()}
			                        onChange={(v) => setNewItemSpecs((prev) => prev.map((p, i) => (i === sIdx ? { ...p, value: v } : p)))}
			                        disabled={!row.specificationId}
			                        placeholder={row.specificationId ? 'Search or type value...' : 'Select spec first'}
			                        showCreateWhenEmpty
			                        alwaysShowCreate
			                        allowEmptyCreate
			                        closeOnCreate
			                        createLabel={(q) => (q ? `+ Add New "${q}"` : '+ Add New')}
			                        onCreate={async (label) => {
			                          setCreateValueInlineError(null);
			                          setCreateValueInlineIndex(sIdx);
			                          setCreateValueInlineValue(label.trim());
			                          return null;
			                        }}
			                      />
			                    </label>
		                  </div>
		                ))}

	                <button
	                  type="button"
	                  className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                  onClick={() => setNewItemSpecs((prev) => [...prev, { specificationId: '', value: '' }])}
	                >
	                  + Add Spec Row
	                </button>
	              </div>

		              <div className="flex justify-end gap-2">
	                <button
	                  type="button"
	                  className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                  onClick={() => {
	                    setCreateItemOpen(false);
	                    setCreateItemRowIndex(null);
	                  }}
	                >
	                  Cancel
	                </button>
	                <button
	                  type="button"
	                  className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                  disabled={
	                    creatingItem ||
	                    !newItemItemNameId ||
	                    newItemSpecs.filter((s) => s.specificationId.trim() && s.value.trim()).length === 0
	                  }
	                  onClick={() => {
	                    if (creatingItem) return;
	                    setCreatingItem(true);
	                    setError(null);
	                    createItem({
	                      itemNameId: newItemItemNameId,
	                      unit: newItemUnit,
	                      description: newItemDescription,
	                      specs: newItemSpecs,
	                      createdBy: 'system',
	                    })
	                      .then(() => fetchItems())
	                      .then((rows) => {
	                        setMasterItems(rows);
	                        const rowIdx = createItemRowIndex;
	                        if (rowIdx == null) return;
	                        const created = rows[0];
	                        if (!created) return;
		                        setItems((prev) =>
		                          prev.map((p, i) =>
		                            i === rowIdx
		                              ? {
		                                  ...p,
		                                  itemId: created.id,
		                                  item: created.itemName,
		                                  specification: formatSpecsLines(created.specificationsJson).join('\n').trim(),
		                                }
		                              : p
		                          )
		                        );
	                      })
	                      .then(() => {
	                        setCreateItemOpen(false);
	                        setCreateItemRowIndex(null);
	                      })
	                      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                      .finally(() => setCreatingItem(false));
	                  }}
	                >
	                  {creatingItem ? 'Creating...' : 'Create Item'}
	                </button>
	              </div>
			            </div>
		                  </div>

		                </div>
		              ) : null}
		    </div>
		  );
}
