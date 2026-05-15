import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import { createDamage } from '@/src/lib/stockMaster';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import InlineCreateDialog from '@/src/components/common/InlineCreateDialog';
import { Trash2 } from 'lucide-react';
				import {
				  createItem,
				  createDepartment,
				  createItemName,
				  createSpecification,
				  createSpecificationValue,
				  fetchDepartments,
				  fetchStores,
				  fetchProjects,
				  fetchUsers,
				  fetchItemNames,
				  fetchUnits,
				  fetchItemCategories,
				  createUnit,
				  createItemCategory,
				  fetchItems,
				  fetchSpecifications,
				  fetchSpecificationValues,
				  updateItem,
				  type Department,
				  type Store,
				  type Project,
				  type Item,
				  type ItemName,
				  type Specification,
				  type SpecificationValue,
				  type Unit,
				  type ItemCategory,
				  type User,
				} from '@/src/lib/masters';

export default function DamageView({
  onCreated,
  onCancel,
}: {
  onCreated: (newId?: string) => void;
  onCancel: () => void;
}) {
  type ItemDraft = {
    itemId: string;
    itemNameId: string;
    item: string;
    quantity: string;
    specification: string;
    specs: Record<string, string>;
    remark: string;
  };

  function formatSpecsLines(specificationsJson: string, specNameById?: Record<string, string>) {
    try {
      const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
      const entries = Object.entries(obj);
      return entries
        .map(([specId, v]) => `${specNameById?.[specId] ?? specId}: ${String(v ?? '')}`)
        .filter(Boolean);
    } catch {
      return specificationsJson
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  function specValueKey(itemNameId: string, specificationId: string) {
    return `${itemNameId}::${specificationId}`;
  }

		  const [firms, setFirms] = useState<Firm[]>([]);
		  const [loadingFirms, setLoadingFirms] = useState(true);
			  const [departments, setDepartments] = useState<Department[]>([]);
			  const [loadingDepartments, setLoadingDepartments] = useState(true);
			  const [departmentId, setDepartmentId] = useState('');
			  const [stores, setStores] = useState<Store[]>([]);
			  const [loadingStores, setLoadingStores] = useState(true);
			  const [storeId, setStoreId] = useState('');
			  const [projects, setProjects] = useState<Project[]>([]);
			  const [loadingProjects, setLoadingProjects] = useState(true);
			  const [projectId, setProjectId] = useState('');
			  const [approvedByUserId, setApprovedByUserId] = useState('');
			  const [users, setUsers] = useState<User[]>([]);
			  const [loadingUsers, setLoadingUsers] = useState(true);
			  const [requestedByUserId, setRequestedByUserId] = useState('');
		  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10));
		  const [firmId, setFirmId] = useState('');
			  const [items, setItems] = useState<ItemDraft[]>([{ itemId: '', itemNameId: '', item: '', quantity: '', specification: '', specs: {}, remark: '' }]);
	  const [itemRowErrors, setItemRowErrors] = useState<string[]>([]);
	  const [itemNames, setItemNames] = useState<ItemName[]>([]);
	  const [loadingItemNames, setLoadingItemNames] = useState(true);
	  const [units, setUnits] = useState<Unit[]>([]);
	  const [loadingUnits, setLoadingUnits] = useState(true);
	  const [itemCategories, setItemCategories] = useState<ItemCategory[]>([]);
	  const [loadingItemCategories, setLoadingItemCategories] = useState(true);
	  const [masterItems, setMasterItems] = useState<Item[]>([]);
	  const [loadingMasterItems, setLoadingMasterItems] = useState(true);
	  const [specs, setSpecs] = useState<Specification[]>([]);
	  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});
	  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);

	  const [createItemOpen, setCreateItemOpen] = useState(false);
	  const [createItemRowIndex, setCreateItemRowIndex] = useState<number | null>(null);
	  const [editingMasterItemId, setEditingMasterItemId] = useState<string | null>(null);
	  const [newItemItemNameId, setNewItemItemNameId] = useState('');
	  const [newItemUnit, setNewItemUnit] = useState('');
	  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemSpecs, setNewItemSpecs] = useState<Array<{ specificationId: string; value: string }>>([{ specificationId: '', value: '' }]);
  const [creatingItem, setCreatingItem] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createItemNameInlineOpen, setCreateItemNameInlineOpen] = useState(false);
  const [createItemNameInlineValue, setCreateItemNameInlineValue] = useState('');
  const [createItemNameInlineUnitId, setCreateItemNameInlineUnitId] = useState('');
  const [createItemNameInlineCategoryId, setCreateItemNameInlineCategoryId] = useState('');
  const [createItemNameInlineBusy, setCreateItemNameInlineBusy] = useState(false);
  const [createItemNameInlineError, setCreateItemNameInlineError] = useState<string | null>(null);

  const [createUnitInlineOpen, setCreateUnitInlineOpen] = useState(false);
  const [createUnitInlineName, setCreateUnitInlineName] = useState('');
  const [createUnitInlineBusy, setCreateUnitInlineBusy] = useState(false);
  const [createUnitInlineError, setCreateUnitInlineError] = useState<string | null>(null);

  const [createCategoryInlineOpen, setCreateCategoryInlineOpen] = useState(false);
  const [createCategoryInlineName, setCreateCategoryInlineName] = useState('');
  const [createCategoryInlineBusy, setCreateCategoryInlineBusy] = useState(false);
  const [createCategoryInlineError, setCreateCategoryInlineError] = useState<string | null>(null);

	  const [createSpecInlineIndex, setCreateSpecInlineIndex] = useState<number | null>(null);
	  const [createSpecInlineValue, setCreateSpecInlineValue] = useState('');
	  const [createSpecInlineBusy, setCreateSpecInlineBusy] = useState(false);
	  const [createSpecInlineError, setCreateSpecInlineError] = useState<string | null>(null);

	  const [createValueInlineIndex, setCreateValueInlineIndex] = useState<number | null>(null);
	  const [createValueInlineValue, setCreateValueInlineValue] = useState('');
	  const [createValueInlineBusy, setCreateValueInlineBusy] = useState(false);
	  const [createValueInlineError, setCreateValueInlineError] = useState<string | null>(null);

				  const inputClass =
				    'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface-variant placeholder:text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15';

		  useEffect(() => {
		    const ac = new AbortController();
		    setLoadingFirms(true);
		    fetchFirms(ac.signal)
	      .then((rows) => {
	        setFirms(rows);
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
			    setLoadingDepartments(true);
			    fetchDepartments(ac.signal)
			      .then((rows) => setDepartments(rows))
		      .catch((e) => {
		        if (ac.signal.aborted) return;
		        if (e instanceof DOMException && e.name === 'AbortError') return;
		        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
		        setError(e instanceof Error ? e.message : String(e));
		      })
		      .finally(() => setLoadingDepartments(false));
			    return () => ac.abort();
			  }, []);

			  useEffect(() => {
			    const ac = new AbortController();
			    setLoadingStores(true);
			    fetchStores(ac.signal)
			      .then((rows) => setStores(rows))
			      .catch((e) => {
			        if (ac.signal.aborted) return;
			        if (e instanceof DOMException && e.name === 'AbortError') return;
			        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
			        setError(e instanceof Error ? e.message : String(e));
			      })
			      .finally(() => setLoadingStores(false));
			    return () => ac.abort();
			  }, []);

	  useEffect(() => {
	    const ac = new AbortController();
	    setLoadingUnits(true);
	    fetchUnits(ac.signal)
	      .then((rows) => setUnits(rows))
	      .catch(() => {})
	      .finally(() => setLoadingUnits(false));
	    return () => ac.abort();
	  }, []);

	  useEffect(() => {
	    const ac = new AbortController();
	    setLoadingItemCategories(true);
	    fetchItemCategories(ac.signal)
	      .then((rows) => setItemCategories(rows))
	      .catch(() => {})
	      .finally(() => setLoadingItemCategories(false));
	    return () => ac.abort();
	  }, []);

			  useEffect(() => {
			    const ac = new AbortController();
			    setLoadingProjects(true);
			    fetchProjects(ac.signal)
			      .then((rows) => setProjects(rows))
			      .catch((e) => {
			        if (ac.signal.aborted) return;
			        if (e instanceof DOMException && e.name === 'AbortError') return;
			        if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
			        setError(e instanceof Error ? e.message : String(e));
			      })
			      .finally(() => setLoadingProjects(false));
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
    const row = itemNames.find((n) => n.id === newItemItemNameId);
    if (!row) {
      setNewItemUnit('');
      return;
    }
    const unitName = row.unitName || (row.unitId ? units.find((u) => u.id === row.unitId)?.name ?? '' : '');
    setNewItemUnit(unitName);
  }, [itemNames, newItemItemNameId, units]);

		      useEffect(() => {
		        if (!createItemOpen) {
		          setCreateItemNameInlineOpen(false);
	          setCreateItemNameInlineValue('');
            setCreateItemNameInlineUnitId('');
            setCreateItemNameInlineCategoryId('');
	          setCreateItemNameInlineBusy(false);
	          setCreateItemNameInlineError(null);
	          setCreateUnitInlineOpen(false);
	          setCreateUnitInlineName('');
	          setCreateUnitInlineBusy(false);
	          setCreateUnitInlineError(null);
	          setCreateCategoryInlineOpen(false);
	          setCreateCategoryInlineName('');
	          setCreateCategoryInlineBusy(false);
	          setCreateCategoryInlineError(null);
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

  const closeCreateUnitInline = () => {
    setCreateUnitInlineOpen(false);
    setCreateUnitInlineName('');
    setCreateUnitInlineError(null);
  };

  const submitCreateUnitInline = () => {
    const name = createUnitInlineName.trim();
    if (!name) {
      setCreateUnitInlineError('Please enter Unit.');
      return;
    }
    if (createUnitInlineBusy) return;
    setCreateUnitInlineBusy(true);
    setCreateUnitInlineError(null);
    createUnit({ name, createdBy: 'system' })
      .then((created) => {
        const unit = created.unit;
        if (!unit?.id) return;
        setUnits((prev) => {
          if (prev.some((p) => p.id === unit.id)) return prev;
          return [...prev, unit].sort((a, b) => a.name.localeCompare(b.name));
        });
        setCreateItemNameInlineUnitId(unit.id);
        closeCreateUnitInline();
      })
      .catch((e) => setCreateUnitInlineError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCreateUnitInlineBusy(false));
  };

  const closeCreateCategoryInline = () => {
    setCreateCategoryInlineOpen(false);
    setCreateCategoryInlineName('');
    setCreateCategoryInlineError(null);
  };

  const submitCreateCategoryInline = () => {
    const name = createCategoryInlineName.trim();
    if (!name) {
      setCreateCategoryInlineError('Please enter Item Category.');
      return;
    }
    if (createCategoryInlineBusy) return;
    setCreateCategoryInlineBusy(true);
    setCreateCategoryInlineError(null);
    createItemCategory({ name, createdBy: 'system' })
      .then((created) => {
        const cat = created.itemCategory;
        if (!cat?.id) return;
        setItemCategories((prev) => {
          if (prev.some((p) => p.id === cat.id)) return prev;
          return [...prev, cat].sort((a, b) => a.name.localeCompare(b.name));
        });
        setCreateItemNameInlineCategoryId(cat.id);
        closeCreateCategoryInline();
      })
      .catch((e) => setCreateCategoryInlineError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCreateCategoryInlineBusy(false));
  };

					  const canSubmit = useMemo(() => {
					    if (!firmId || !storeId.trim() || !departmentId.trim() || !requestedByUserId.trim() || !requiredDate.trim() || !approvedByUserId.trim()) return false;
						    const normalized = items
						      .map((it) => ({
                    itemId: String(it.itemId ?? '').trim(),
						        item: it.item.trim(),
						        quantity: Number(it.quantity),
				        specification: it.specification.trim(),
				        remark: it.remark.trim(),
							    }))
							    .filter((it) => it.itemId && it.item && Number.isFinite(it.quantity) && it.quantity > 0 && it.specification && it.remark);
						    return normalized.length > 0;
						  }, [departmentId, firmId, items, requestedByUserId, requiredDate, approvedByUserId, storeId]);

  const getItemNameSpecIds = (itemNameId: string): string[] => {
    const row = itemNames.find((n) => n.id === itemNameId);
    const ids = Array.isArray((row as any)?.specificationIds) ? ((row as any).specificationIds as any[]).map((x) => String(x)) : [];
    return ids.filter(Boolean);
  };

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

			  const storeOptions = useMemo(() => {
			    const list = firmId ? stores.filter((s) => s.firmId === firmId) : stores;
			    return list.map((s) => ({ value: s.id, label: s.name }));
			  }, [firmId, stores]);

		  const closeCreateItemName = () => {
		    setCreateItemNameInlineOpen(false);
		    setCreateItemNameInlineValue('');
        setCreateItemNameInlineUnitId('');
        setCreateItemNameInlineCategoryId('');
		    setCreateItemNameInlineError(null);
		  };

		  const submitCreateItemName = () => {
		    const v = createItemNameInlineValue.trim();
		    if (!v) {
		      setCreateItemNameInlineError('Please enter Item Name.');
		      return;
		    }
        if (!createItemNameInlineUnitId) {
          setCreateItemNameInlineError('Please select Unit.');
          return;
        }
        if (!createItemNameInlineCategoryId) {
          setCreateItemNameInlineError('Please select Item Category.');
          return;
        }
		    if (createItemNameInlineBusy) return;
		    setCreateItemNameInlineBusy(true);
		    setCreateItemNameInlineError(null);
		    createItemName({ name: v, unitId: createItemNameInlineUnitId, itemCategoryId: createItemNameInlineCategoryId, createdBy: 'system' })
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

			  const projectOptions = useMemo(() => {
			    const list = firmId ? projects.filter((p) => p.firmId === firmId) : projects;
			    return list.map((p) => ({ value: p.id, label: p.name }));
			  }, [firmId, projects]);

				  return (
				    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-6 shadow-[0_14px_40px_-28px_rgba(0,0,0,0.35)] space-y-5">
			      {error ? (
			        <div className="bg-error-container/40 rounded-xl border border-outline-variant p-3 text-sm text-on-surface-variant">
			          {error}
			        </div>
		      ) : null}

				      <div className="rounded-2xl bg-surface-container-low p-3 shadow-sm">
		        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm</div>
	            <SearchableSelect
	              value={firmId}
	              options={firms.map((f) => ({ value: f.id, label: f.name }))}
	              onChange={setFirmId}
	              disabled={loadingFirms}
	              placeholder="Select firm..."
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Department</div>
	            <SearchableSelect
	              value={departmentId}
	              options={departments.map((d) => ({ value: d.id, label: d.name }))}
	              onChange={setDepartmentId}
	              disabled={loadingDepartments}
	              placeholder="Select department..."
	              onCreate={(label) =>
	                createDepartment({ name: label.trim(), createdBy: 'system' }).then((res) => {
	                  const created = res.department;
	                  if (!created?.id) return null;
	                  setDepartments((prev) => {
	                    if (prev.some((p) => p.id === created.id)) return prev;
	                    return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
	                  });
	                  return { value: created.id, label: created.name };
	                })
	              }
	              createLabel={(q) => (q.trim() ? `+ Add Department \"${q.trim()}\"` : '+ Add Department')}
	              closeOnCreate
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Store</div>
	            <SearchableSelect
	              value={storeId}
	              options={storeOptions}
	              onChange={setStoreId}
	              disabled={loadingStores || !firmId}
	              placeholder="Select store..."
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Damage By</div>
	            <SearchableSelect
	              value={requestedByUserId}
	              options={users.map((u) => ({ value: u.id, label: u.name }))}
	              onChange={setRequestedByUserId}
	              disabled={loadingUsers}
	              placeholder="Select user..."
	            />
	          </label>

		          <label className="space-y-1">
		            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Damage Date</div>
		            <input className={inputClass} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} type="date" />
		          </label>

			          <label className="space-y-1">
			            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Project (optional)</div>
			            <SearchableSelect
			              value={projectId}
			              options={projectOptions}
			              onChange={setProjectId}
			              disabled={loadingProjects || !firmId}
			              placeholder="Select project..."
			            />
			          </label>
		        </div>

			        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
			          <label className="space-y-1">
			            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Damage Approved By</div>
			            <SearchableSelect
			              value={approvedByUserId}
			              options={users.map((u) => ({ value: u.name, label: u.name }))}
			              onChange={setApprovedByUserId}
			              disabled={loadingUsers}
			              placeholder="Select user..."
			            />
			          </label>
		        </div>
		      </div>

						      <div className="bg-surface-container-low rounded-2xl p-2 shadow-sm space-y-2">
				        <div className="flex items-center justify-between">
				          <div>
				            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
				          </div>
				        </div>

							        <div className="w-full rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant">
							          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-high border-b border-outline-variant">
							            <div className="md:col-span-3 px-2 py-2 md:border-r md:border-outline-variant">Item Name</div>
							            <div className="md:col-span-4 px-2 py-2 md:border-r md:border-outline-variant">Specifications</div>
							            <div className="md:col-span-1 px-2 py-2 md:border-r md:border-outline-variant">Qty</div>
							            <div className="md:col-span-3 px-2 py-2 md:border-r md:border-outline-variant">Remark</div>
							            <div className="md:col-span-1 px-2 py-2 text-right">Action</div>
							          </div>

					          {items.map((row, idx) => (
					            <div
					              key={idx}
							              className={[
							                'grid grid-cols-1 md:grid-cols-12 gap-0 bg-surface-container-lowest',
							                idx === 0 ? '' : 'border-t border-outline-variant',
							              ].join(' ')}
							            >
						              <div className="md:col-span-3 px-2 py-2 md:border-r md:border-outline-variant space-y-2">
						                <SearchableSelect
					                  value={row.itemNameId}
					                  options={itemNames.map((it) => ({ value: it.id, label: it.name }))}
					                  onChange={(itemNameId) => {
				                    setItemRowErrors((prev) => prev.map((m, i) => (i === idx ? '' : m)));
                            const specIdsToLoad = itemNameId ? getItemNameSpecIds(itemNameId) : [];
                            for (const specId of specIdsToLoad) {
                              const key = specValueKey(itemNameId, specId);
                              if ((specValueOptions[key] ?? []).length) continue;
                              fetchSpecificationValues(specId, { itemNameId })
                                .then((vals) => setSpecValueOptions((m) => ({ ...m, [key]: vals })))
                                .catch(() => {});
                            }
				                    setItems((prev) =>
				                      prev.map((p, i) => (i === idx ? { ...p, itemNameId, itemId: '', item: '', specification: '', specs: {} } : p))
				                    );
					                  }}
					                  disabled={loadingItemNames}
					                  placeholder="Search item name..."
					                  allowClear
			                />
				              </div>
							              <div className="md:col-span-4 px-2 py-2 md:border-r md:border-outline-variant">
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
                                              setItemRowErrors((prev) => prev.map((m, i) => (i === idx ? '' : m)));
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
                                                    specification: matched ? formatSpecsLines(matched.specificationsJson, specNameById).join('\n').trim() : '',
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
							              </div>
						              <div className="md:col-span-1 px-2 py-2 md:border-r md:border-outline-variant space-y-1">
						                <input
						                  className={inputClass}
				                  placeholder="Qty"
				                  type="number"
				                  inputMode="numeric"
				                  min={0}
				                  step={1}
				                  value={row.quantity}
				                  onChange={(e) => {
				                    const v = String(e.target.value ?? '');
				                    setItemRowErrors((prev) => prev.map((m, i) => (i === idx ? '' : m)));
				                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: v } : p)));
				                  }}
				                />
				                {itemRowErrors[idx] ? <div className="text-[11px] text-error">{itemRowErrors[idx]}</div> : null}
				              </div>
						              <div className="md:col-span-3 px-2 py-2 md:border-r md:border-outline-variant space-y-1">
						                <input
						                  className={inputClass}
				                  placeholder="Remark (Required)"
				                  value={row.remark}
				                  onChange={(e) => {
				                    const v = e.target.value;
				                    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, remark: v } : p)));
				                  }}
				                />
				              </div>
							              <div className="md:col-span-1 px-2 py-2 flex md:justify-end">
							                <div className="flex items-center gap-2">
						                  <button
						                    type="button"
						                    className="btn-icon-danger"
						                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
					                    disabled={items.length === 1}
					                    title={items.length === 1 ? 'At least one item required' : 'Remove item'}
					                  >
				                    <Trash2 size={16} />
				                  </button>
					                </div>
					          </div>
					            </div>
						          ))}
								          <div className="border-t border-outline-variant bg-surface-container-lowest px-2 py-2 flex items-center justify-between gap-3">
								            <div className="flex items-center gap-3">
									              <button
								                type="button"
								                className="btn-primary"
									                onClick={() => setItems((prev) => [...prev, { itemId: '', itemNameId: '', item: '', quantity: '', specification: '', specs: {}, remark: '' }])}
							              >
						                + Add Item
						              </button>
					            </div>

						            <div className="flex items-center gap-2">
								              <button
								                type="button"
							                onClick={onCancel}
							                className="btn"
							              >
						                Cancel
						              </button>
				              <button
				                type="button"
				                onClick={() => {
				                  if (saving) return;
					                  setError(null);
					                  const rowMessages: string[] = [];
					                  const usedItemIds = new Set<string>();
					                  const normalizedItems = items
					                    .map((it, i) => {
					                      const itemName = it.item.trim();
					                      const itemId = String(it.itemId ?? '').trim();
					                      const quantityNumber = Number(it.quantity);
					                      const specification = it.specification.trim();
					                      const remark = it.remark.trim();
					                      if (!itemId || !itemName) rowMessages[i] = 'Select Item.';
					                      else if (usedItemIds.has(itemId)) rowMessages[i] = 'Item already selected.';
					                      else if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) rowMessages[i] = 'Enter valid Qty.';
					                      else if (!specification) rowMessages[i] = 'Missing specification.';
					                      else if (!remark) rowMessages[i] = 'Remark is required.';
					                      if (itemId) usedItemIds.add(itemId);
					                      return { itemId, item: itemName, quantity: quantityNumber, specification };
					                      })
					                    .filter((_, i) => !rowMessages[i]);
					                  setItemRowErrors(rowMessages);

								                  const department = departments.find((d) => d.id === departmentId)?.name ?? '';
								                  const requestedBy = users.find((u) => u.id === requestedByUserId)?.name ?? '';
								                  const store = stores.find((s) => s.id === storeId)?.name ?? '';
								                  if (!firmId || !store.trim() || !department.trim() || !requestedBy.trim() || !requiredDate.trim() || !normalizedItems.length || !approvedByUserId.trim()) {
								                    setError('Please fill Firm, Store, Department, Damage By, Damage Date, Approved By, and all item remarks.');
								                    return;
						                  }

					                  setSaving(true);
						                  createDamage({
						                    firmId: firmId,
						                    storeId: storeId,
						                    store,
						                    department,
						                    projectId: projectId || undefined,
						                    person: requestedBy,
						                    date: requiredDate,
						                    approvedBy: approvedByUserId,
						                    items: normalizedItems
						                  }).then(created => onCreated(created.id))				                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
				                    .finally(() => setSaving(false));
				                }}
							                className="btn-primary"
							                disabled={saving || !canSubmit}
							              >
						                {saving ? (
						                  <span className="inline-flex items-center gap-2">
						                    <Spinner className="h-3 w-3" />
						                    Damaging...
						                  </span>
						                ) : (
						                  'Damage'
						                )}
						              </button>
				            </div>
				          </div>
				        </div>
	      </div>

			      {createItemOpen ? (
			        <div className="fixed inset-0 z-50">
			          <button
			            type="button"
			            className="absolute inset-0 bg-black/40"
			            aria-label="Close"
	            onClick={() => {
	              setCreateItemOpen(false);
	              setCreateItemRowIndex(null);
	            }}
	          />
					          <div className="relative w-full h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col">
				            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
					              <div className="text-sm font-bold text-on-surface">{editingMasterItemId ? 'Edit Item' : 'Create Item'}</div>
				              <button
			                type="button"
		                className="btn btn-sm"
		                onClick={() => {
		                  setCreateItemOpen(false);
		                  setCreateItemRowIndex(null);
		                  setEditingMasterItemId(null);
		                }}
		              >
		                Close
			              </button>
			            </div>

				            <div className="flex-1 overflow-auto p-5 space-y-3">
					              {error ? (
					                <div className="bg-error-container/30 rounded-xl border border-outline-variant p-3 text-sm text-on-surface-variant">
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
				                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl">
				                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
			                          <div className="text-sm font-bold text-on-surface">Create new Item Name</div>
			                          <button
			                            type="button"
			                            className="btn btn-sm"
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
                                <label className="space-y-1">
                                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
                                  <SearchableSelect
                                    value={createItemNameInlineUnitId}
                                    options={units.map((u) => ({ value: u.id, label: u.name }))}
                                    onChange={setCreateItemNameInlineUnitId}
                                    placeholder={loadingUnits ? 'Loading units...' : 'Select unit...'}
                                    disabled={loadingUnits}
                                    showCreateWhenEmpty
                                    allowEmptyCreate
                                    closeOnCreate
                                    createLabel={(q) => (q.trim() ? `+ Add Unit "${q.trim()}"` : '+ Add Unit')}
                                    onCreate={async (label) => {
                                      setCreateUnitInlineError(null);
                                      setCreateUnitInlineName(String(label ?? '').trim());
                                      setCreateUnitInlineOpen(true);
                                      return null;
                                    }}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Category</div>
                                  <SearchableSelect
                                    value={createItemNameInlineCategoryId}
                                    options={itemCategories.map((c) => ({ value: c.id, label: c.name }))}
                                    onChange={setCreateItemNameInlineCategoryId}
                                    placeholder={loadingItemCategories ? 'Loading categories...' : 'Select category...'}
                                    disabled={loadingItemCategories}
                                    showCreateWhenEmpty
                                    allowEmptyCreate
                                    closeOnCreate
                                    createLabel={(q) => (q.trim() ? `+ Add Category "${q.trim()}"` : '+ Add Category')}
                                    onCreate={async (label) => {
                                      setCreateCategoryInlineError(null);
                                      setCreateCategoryInlineName(String(label ?? '').trim());
                                      setCreateCategoryInlineOpen(true);
                                      return null;
                                    }}
                                  />
                                </label>
			                          <div className="flex justify-end gap-2">
			                            <button
			                              type="button"
			                              className="btn btn-sm"
			                              onClick={closeCreateItemName}
			                            >
			                              Cancel
			                            </button>
			                            <button
			                              type="button"
			                              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                              disabled={createItemNameInlineBusy || !createItemNameInlineValue.trim() || !createItemNameInlineUnitId || !createItemNameInlineCategoryId}
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

			              <InlineCreateDialog
                  open={createUnitInlineOpen}
                  title="Add Unit"
                  value={createUnitInlineName}
                  setValue={setCreateUnitInlineName}
                  error={createUnitInlineError}
                  busy={createUnitInlineBusy}
                  placeholder="Enter unit name"
                  onClose={closeCreateUnitInline}
                  onSubmit={submitCreateUnitInline}
                />

			              <InlineCreateDialog
                  open={createCategoryInlineOpen}
                  title="Add Item Category"
                  value={createCategoryInlineName}
                  setValue={setCreateCategoryInlineName}
                  error={createCategoryInlineError}
                  busy={createCategoryInlineBusy}
                  placeholder="Enter category name"
                  onClose={closeCreateCategoryInline}
                  onSubmit={submitCreateCategoryInline}
                />

			              {createSpecInlineIndex != null
			                ? createPortal(
			                    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
			                      <button
			                        type="button"
			                        className="absolute inset-0 bg-black/40"
			                        aria-label="Close"
			                        onClick={closeCreateSpec}
			                      />
				                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl">
				                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
			                          <div className="text-sm font-bold text-on-surface">Create new Specification</div>
			                          <button
			                            type="button"
			                            className="btn btn-sm"
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
			                              className="btn btn-sm"
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
				                      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl">
				                        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
			                          <div className="text-sm font-bold text-on-surface">Add new Value</div>
			                          <button
			                            type="button"
			                            className="btn btn-sm"
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
			                              className="btn btn-sm"
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
		                  onChange={(id) => {
                        setNewItemItemNameId(id);
                        const row = itemNames.find((n) => n.id === id);
                        const unitName = row?.unitName || (row?.unitId ? units.find((u) => u.id === row.unitId)?.name ?? '' : '');
                        setNewItemUnit(unitName);
                      }}
		                  placeholder="Search item name..."
		                  showCreateWhenEmpty
		                  allowEmptyCreate
		                  closeOnCreate
		                  createLabel={(q) => (q ? `+ Create Item Name "${q}"` : '+ Create Item Name')}
		                  onCreate={async (label) => {
			                    setCreateItemNameInlineError(null);
			                    setCreateItemNameInlineValue(label.trim());
                          setCreateItemNameInlineCategoryId('');
			                    setCreateItemNameInlineOpen(true);
			                    return null;
			                  }}
			                />
			              </label>

			              <label className="space-y-1">
			                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
                      <input
                        className={`${inputClass} opacity-80`}
                        value={newItemUnit}
                        readOnly
                        disabled
                        placeholder="Select item name first"
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
				                  <div key={sIdx} className="bg-surface-container-low rounded-lg border border-outline-variant p-3 space-y-2">
	                    <div className="flex items-center justify-between gap-2">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Spec Row {sIdx + 1}</div>
	                      <button
	                        type="button"
                        className="btn btn-sm disabled:opacity-50"
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
	                  className="btn btn-sm"
	                  onClick={() => setNewItemSpecs((prev) => [...prev, { specificationId: '', value: '' }])}
	                >
	                  + Add Spec Row
	                </button>
	              </div>

		              <div className="flex justify-end gap-2">
		                <button
		                  type="button"
		                  className="btn btn-sm"
		                  onClick={() => {
		                    setCreateItemOpen(false);
		                    setCreateItemRowIndex(null);
		                    setEditingMasterItemId(null);
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
		                    const action = editingMasterItemId
		                      ? updateItem(editingMasterItemId, {
		                          itemNameId: newItemItemNameId,
		                          unit: newItemUnit,
		                          description: newItemDescription,
		                          specs: newItemSpecs,
		                          updatedBy: 'system',
		                        })
		                      : createItem({
		                          itemNameId: newItemItemNameId,
		                          unit: newItemUnit,
		                          description: newItemDescription,
		                          specs: newItemSpecs,
		                          createdBy: 'system',
		                        });
		                    action
		                      .then(() => fetchItems())
		                      .then((rows) => {
		                        setMasterItems(rows);
		                        const rowIdx = createItemRowIndex;
		                        if (rowIdx == null) return;
		                        const updatedOrCreated = editingMasterItemId
		                          ? rows.find((r) => r.id === editingMasterItemId) ?? null
		                          : rows[0] ?? null;
		                        if (!updatedOrCreated) return;
		                        setItems((prev) =>
		                          prev.map((p, i) =>
		                            i === rowIdx
		                              ? {
		                                  ...p,
		                                  itemId: updatedOrCreated.id,
		                                  item: updatedOrCreated.itemName,
		                                  specification: formatSpecsLines(updatedOrCreated.specificationsJson, specNameById).join('\n').trim(),
		                                }
		                              : p
		                          )
		                        );
		                      })
		                      .then(() => {
		                        setCreateItemOpen(false);
		                        setCreateItemRowIndex(null);
		                        setEditingMasterItemId(null);
		                      })
		                      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
		                      .finally(() => setCreatingItem(false));
		                  }}
		                >
		                  {creatingItem ? 'Saving...' : editingMasterItemId ? 'Save Item' : 'Create Item'}
		                </button>
	              </div>
			            </div>
		                  </div>

		                </div>
		              ) : null}
		    </div>
		  );
}
