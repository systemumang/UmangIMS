import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPurchaseRequest, fetchFirms, type Firm } from '@/src/lib/purchaseRequests';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Spinner from '@/src/components/common/Spinner';
import InlineCreateDialog from '@/src/components/common/InlineCreateDialog';
import { Trash2 } from 'lucide-react';
				import {
				  createItem,
				  createItemName,
				  createSpecification,
				  createSpecificationValue,
				  fetchStores,
					  fetchProjects,
					  fetchUsers,
            fetchPriorities,
				  fetchItemNames,
				  fetchUnits,
				  fetchItemCategories,
				  createUnit,
				  createItemCategory,
				  fetchItems,
				  fetchSpecifications,
				  fetchSpecificationValues,
				  updateItem,
				  type Store,
				  type Project,
				  type Item,
				  type ItemName,
				  type Specification,
				  type SpecificationValue,
				  type Unit,
				  type ItemCategory,
					  type User,
            type Priority,
					} from '@/src/lib/masters';

export default function NewPurchaseRequestView({
  onCreated,
  onCancel,
}: {
  onCreated: (newId?: string) => void;
  onCancel: () => void;
}) {
  type ItemDraft = { itemNameId: string; quantity: string; priorityId: string; specs: Record<string, string> };

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

  function getItemNameSpecIds(itemNameId: string): string[] {
    const row = itemNames.find((n) => n.id === itemNameId);
    const ids = Array.isArray((row as any)?.specificationIds) ? ((row as any).specificationIds as any[]).map((x) => String(x)) : [];
    return ids.filter(Boolean);
  }

		  const [firms, setFirms] = useState<Firm[]>([]);
		  const [loadingFirms, setLoadingFirms] = useState(true);
			  const [stores, setStores] = useState<Store[]>([]);
			  const [loadingStores, setLoadingStores] = useState(true);
			  const [storeId, setStoreId] = useState('');
			  const [projects, setProjects] = useState<Project[]>([]);
			  const [loadingProjects, setLoadingProjects] = useState(true);
			  const [requestType, setRequestType] = useState<'Stock' | 'Project'>('Stock');
			  const [projectId, setProjectId] = useState('');
				  const [users, setUsers] = useState<User[]>([]);
				  const [loadingUsers, setLoadingUsers] = useState(true);
          const [priorities, setPriorities] = useState<Priority[]>([]);
          const [loadingPriorities, setLoadingPriorities] = useState(true);
				  const [requestedByUserId, setRequestedByUserId] = useState('');
		  const [requiredDate, setRequiredDate] = useState(() => new Date().toISOString().slice(0, 10));
		  const [firmId, setFirmId] = useState('');
				  const [items, setItems] = useState<ItemDraft[]>([{ itemNameId: '', quantity: '', priorityId: '', specs: {} }]);
		  const [itemRowErrors, setItemRowErrors] = useState<string[]>([]);
		  const [reqCreateValueRowIndex, setReqCreateValueRowIndex] = useState<number | null>(null);
		  const [reqCreateValueSpecId, setReqCreateValueSpecId] = useState<string>('');
		  const [reqCreateValueValue, setReqCreateValueValue] = useState('');
		  const [reqCreateValueBusy, setReqCreateValueBusy] = useState(false);
		  const [reqCreateValueError, setReqCreateValueError] = useState<string | null>(null);
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
	  const [createItemNameTargetRowIndex, setCreateItemNameTargetRowIndex] = useState<number | null>(null);
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
	  const [createValueInlineSpecId, setCreateValueInlineSpecId] = useState<string | null>(null);
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
			    if (requestType !== 'Project' && projectId) setProjectId('');
			  }, [projectId, requestType]);

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
          setLoadingPriorities(true);
          fetchPriorities(ac.signal)
            .then((rows) => setPriorities(rows))
            .catch((e) => {
              if (ac.signal.aborted) return;
              if (e instanceof DOMException && e.name === 'AbortError') return;
              if (String((e as any)?.name ?? '').toLowerCase() === 'aborterror') return;
              setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => setLoadingPriorities(false));
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
      const row = itemNames.find((n) => n.id === newItemItemNameId);
      if (!row) {
        setNewItemUnit('');
        return;
      }
      const unitName = row.unitName || (row.unitId ? units.find((u) => u.id === row.unitId)?.name ?? '' : '');
      setNewItemUnit(unitName);
    }, [itemNames, newItemItemNameId, units]);

	  useEffect(() => {
	    const ac = new AbortController();
	    fetchSpecifications(ac.signal)
	      .then(setSpecs)
	      .catch(() => {});
	    return () => ac.abort();
	  }, []);

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

  const previousFirmIdRef = useRef<string>('');

  useEffect(() => {
    const prev = previousFirmIdRef.current;
    if (!prev) {
      previousFirmIdRef.current = firmId;
      return;
    }
    if (prev !== firmId) {
      setStoreId('');
      setProjectId('');
    }
    previousFirmIdRef.current = firmId;
  }, [firmId]);

								  const canSubmit = useMemo(() => {
								    if (!firmId || !storeId.trim() || !requestedByUserId.trim() || !requiredDate.trim()) return false;
								    if (requestType === 'Project' && !projectId.trim()) return false;
                  const hasValidRows = items.some((it) => {
                    const itemNameId = String(it.itemNameId ?? '').trim();
                    const quantity = Number(it.quantity);
                    if (!itemNameId || !Number.isFinite(quantity) || quantity <= 0) return false;
                    const requiredSpecIds = getItemNameSpecIds(itemNameId);
                    return requiredSpecIds.every((sid) => String(it.specs?.[sid] ?? '').trim());
                  });
							    return hasValidRows;
								  }, [firmId, items, projectId, requestedByUserId, requiredDate, requestType, storeId]);

			  const storeOptions = useMemo(() => {
			    const list = firmId ? stores.filter((s) => s.firmId === firmId) : stores;
			    return list.map((s) => ({ value: s.id, label: s.name }));
			  }, [firmId, stores]);

  const orderedPriorities = useMemo(() => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...priorities].sort((a, b) => {
      const ra = rank[String(a.name ?? '').trim().toLowerCase()];
      const rb = rank[String(b.name ?? '').trim().toLowerCase()];
      const wa = Number.isFinite(ra) ? ra : 99;
      const wb = Number.isFinite(rb) ? rb : 99;
      if (wa !== wb) return wa - wb;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
  }, [priorities]);

  const specColumnIds = useMemo(() => {
    const seen = new Set<string>();
    for (const row of items) {
      const itemNameId = String(row.itemNameId ?? '').trim();
      if (!itemNameId) continue;
      for (const specId of getItemNameSpecIds(itemNameId)) {
        if (specId) seen.add(specId);
      }
    }
    return Array.from(seen);
  }, [items, itemNames]);

			  const closeCreateItemName = () => {
			    setCreateItemNameInlineOpen(false);
			    setCreateItemNameTargetRowIndex(null);
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
			        setItems((prev) => {
			          const idx = createItemNameTargetRowIndex;
			          if (idx == null) return prev;
			          return prev.map((p, i) => (i === idx ? { ...p, itemNameId: next.id, specs: {} } : p));
			        });
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

			  const closeReqCreateValue = () => {
			    setReqCreateValueRowIndex(null);
			    setReqCreateValueSpecId('');
			    setReqCreateValueValue('');
			    setReqCreateValueError(null);
			  };

			  const submitReqCreateValue = () => {
			    const rowIdx = reqCreateValueRowIndex;
			    if (rowIdx == null) return;
			    const specId = String(reqCreateValueSpecId ?? '').trim();
			    const v = String(reqCreateValueValue ?? '').trim();
			    const itemNameId = String(items[rowIdx]?.itemNameId ?? '').trim();
			    if (!itemNameId) {
			      setReqCreateValueError('Select Item Name first.');
			      return;
			    }
			    if (!specId) {
			      setReqCreateValueError('Select Specification first.');
			      return;
			    }
			    if (!v) {
			      setReqCreateValueError('Please enter Value.');
			      return;
			    }
			    if (reqCreateValueBusy) return;
			    setReqCreateValueBusy(true);
			    setReqCreateValueError(null);
			    createSpecificationValue({ specificationId: specId, itemNameId, value: v, createdBy: 'system' })
			      .then((created) => {
			        const next = created.specificationValue;
			        const finalValue = String(next?.value ?? v);
			        const key = specValueKey(itemNameId, specId);
			        setSpecValueOptions((m) => {
			          const prev = m[key] ?? [];
			          if (prev.some((p) => p.value === finalValue)) return m;
			          if (next) return { ...m, [key]: [...prev, next] };
			          return {
			            ...m,
			            [key]: [...prev, { id: `NEW-${Date.now()}-${Math.random()}`, specificationId: specId, itemNameId, value: finalValue, isActive: true }],
			          };
			        });
			        setItems((prev) =>
			          prev.map((p, i) => {
			            if (i !== rowIdx) return p;
			            return { ...p, specs: { ...(p.specs ?? {}), [specId]: finalValue } };
			          })
			        );
			        closeReqCreateValue();
			      })
			      .catch((e) => setReqCreateValueError(e instanceof Error ? e.message : String(e)))
			      .finally(() => setReqCreateValueBusy(false));
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
		        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm</div>
	            <SearchableSelect
	              value={firmId}
	              options={firms.map((f) => ({ value: f.id, label: f.name }))}
	              onChange={setFirmId}
	              disabled={loadingFirms}
		              placeholder="Select"
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Store</div>
	            <SearchableSelect
	              value={storeId}
	              options={storeOptions}
	              onChange={setStoreId}
	              disabled={loadingStores || !firmId}
		              placeholder="Select"
	            />
	          </label>

	          <label className="space-y-1">
	            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Requested By</div>
	            <SearchableSelect
	              value={requestedByUserId}
	              options={users.map((u) => ({ value: u.id, label: u.name }))}
	              onChange={setRequestedByUserId}
	              disabled={loadingUsers}
		              placeholder="Select"
	            />
	          </label>

			          <label className="space-y-1">
			            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Required Date</div>
			            <input className={inputClass} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} type="date" />
			          </label>
                <label className="space-y-1">
                  <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Request Type</div>
                  <SearchableSelect
                    value={requestType}
                    options={[
                      { value: 'Stock', label: 'Stock' },
                      { value: 'Project', label: 'Project' },
                    ]}
                    onChange={(v) => setRequestType(v === 'Project' ? 'Project' : 'Stock')}
	                    placeholder="Select"
                  />
                </label>
		        </div>

				          {requestType === 'Project' ? (
				            <label className="space-y-1 block mt-4">
			              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Project Name</div>
			              <SearchableSelect
			                value={projectId}
		                options={projectOptions}
		                onChange={setProjectId}
		                disabled={loadingProjects}
			                placeholder={loadingProjects ? 'Loading...' : projectOptions.length ? 'Select' : 'No options'}
		              />
			            </label>
			          ) : null}
			      </div>

						      <div className="bg-surface-container-low rounded-2xl p-2 shadow-sm space-y-2">
				        <div className="flex items-center justify-between">
				          <div>
				            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Items</div>
				          </div>
				        </div>

									        <div className="w-full rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant">
                            <div className="overflow-x-auto">
                              <div className="min-w-[1280px]">
                                <div
                                  className="grid gap-0 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-surface-container-high border-b border-outline-variant"
                                  style={{ gridTemplateColumns: `280px repeat(${specColumnIds.length || 1}, 220px) 170px 110px 80px` }}
                                >
                                  <div className="px-2 py-2 border-r border-outline-variant">Item Name</div>
                                  {specColumnIds.length ? (
                                    specColumnIds.map((specId) => (
                                      <div key={`hdr-${specId}`} className="px-2 py-2 border-r border-outline-variant">
                                        {specNameById?.[specId] ?? 'Specification'}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="px-2 py-2 border-r border-outline-variant">Specifications</div>
                                  )}
                                  <div className="px-2 py-2 border-r border-outline-variant">Priority</div>
                                  <div className="px-2 py-2 border-r border-outline-variant">Qty</div>
                                  <div className="px-2 py-2 text-right">Action</div>
                                </div>

							          {items.map((row, idx) => {
							            const specIds = row.itemNameId ? getItemNameSpecIds(row.itemNameId) : [];
							            return (
							              <div
							                key={idx}
                                  className={['grid gap-0 bg-surface-container-lowest', idx === 0 ? '' : 'border-t border-outline-variant'].join(' ')}
                                  style={{ gridTemplateColumns: `280px repeat(${specColumnIds.length || 1}, 220px) 170px 110px 80px` }}
							              >
							                <div className="px-2 py-2 border-r border-outline-variant space-y-2">
							                  <SearchableSelect
							                    value={row.itemNameId}
						                    options={itemNames.map((n) => ({ value: n.id, label: n.name }))}
						                    onChange={(id) => {
						                      setItemRowErrors((prev) => prev.map((m, i) => (i === idx ? '' : m)));
						                      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, itemNameId: id, specs: {} } : p)));

						                      // Preload spec values for this Item Name + its linked specifications.
						                      const specIdsToLoad = id ? getItemNameSpecIds(id) : [];
						                      for (const specId of specIdsToLoad) {
						                        const key = specValueKey(id, specId);
						                        if ((specValueOptions[key] ?? []).length) continue;
						                        fetchSpecificationValues(specId, { itemNameId: id })
						                          .then((vals) => setSpecValueOptions((m) => ({ ...m, [key]: vals })))
						                          .catch(() => {});
						                      }
						                    }}
						                    disabled={loadingItemNames}
							                    placeholder="Select"
						                    allowClear
						                    showCreateWhenEmpty
						                    alwaysShowCreate
						                    allowEmptyCreate
						                    closeOnCreate
						                    createLabel={(q) => (q ? `+ Create Item Name \"${q}\"` : '+ Create Item Name')}
						                    onCreate={async (label) => {
						                      const name = String(label ?? '').trim();
						                      if (!name) return null;
						                      setCreateItemNameTargetRowIndex(idx);
						                      setCreateItemNameInlineError(null);
						                      setCreateItemNameInlineValue(name);
						                      setCreateItemNameInlineUnitId('');
						                      setCreateItemNameInlineCategoryId('');
						                      setCreateItemNameInlineOpen(true);
						                      return null;
						                    }}
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
                                    return (
                                      <div key={`${idx}-${specId}`} className="px-2 py-2 border-r border-outline-variant">
							                  {row.itemNameId && isRequiredForRow ? (
							                    <div className="space-y-1">
							                      {(() => {
							                        const specName = specNameById?.[specId] ?? specId;
							                        const value = String(row.specs?.[specId] ?? '');
							                        const key = specValueKey(row.itemNameId, specId);
						                        const options = (specValueOptions[key] ?? []).map((v) => ({ value: v.value, label: v.value }));
						                        if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value });
							                        return (
							                          <label className="space-y-1">
							                            <SearchableSelect
							                              value={value}
							                              options={options}
							                              placeholder="Select"
						                              showCreateWhenEmpty
						                              alwaysShowCreate
						                              allowEmptyCreate
						                              closeOnCreate
						                              createLabel={(q) => (q ? `+ Add New \"${q}\"` : '+ Add New')}
						                              onChange={(v) => {
						                                setItemRowErrors((prev) => prev.map((m, i) => (i === idx ? '' : m)));
						                                setItems((prev) =>
						                                  prev.map((p, i) =>
						                                    i === idx ? { ...p, specs: { ...(p.specs ?? {}), [specId]: v } } : p
						                                  )
						                                );
						                              }}
								                              onCreate={async (label) => {
								                                const v = String(label ?? '').trim();
								                                // If the user typed a value, create it immediately and auto-select it.
								                                // This is more reliable than opening a modal from inside a dropdown click.
								                                if (v) {
								                                  const itemNameId = String(items[idx]?.itemNameId ?? '').trim();
								                                  if (!itemNameId) return null;
								                                  try {
								                                    const created = await createSpecificationValue({
								                                      specificationId: specId,
								                                      itemNameId,
								                                      value: v,
								                                      createdBy: 'system',
								                                    });
								                                    const next = created?.specificationValue;
								                                    const finalValue = String(next?.value ?? v);
								                                    const key = specValueKey(itemNameId, specId);
								                                    setSpecValueOptions((m) => {
								                                      const prev = m[key] ?? [];
								                                      if (prev.some((p) => p.value === finalValue)) return m;
								                                      if (next) return { ...m, [key]: [...prev, next] };
								                                      return {
								                                        ...m,
								                                        [key]: [
								                                          ...prev,
								                                          {
								                                            id: `NEW-${Date.now()}-${Math.random()}`,
								                                            specificationId: specId,
								                                            itemNameId,
								                                            value: finalValue,
								                                            isActive: true,
								                                          },
								                                        ],
								                                      };
								                                    });
								                                    // Return created option so SearchableSelect selects it.
								                                    return { value: finalValue, label: finalValue };
								                                  } catch {
								                                    // Fallback: open modal to show error/details.
								                                  }
								                                }

								                                // Fallback: open modal (e.g., empty create or error path).
								                                setTimeout(() => {
								                                  setReqCreateValueError(null);
								                                  setReqCreateValueRowIndex(idx);
								                                  setReqCreateValueSpecId(specId);
								                                  setReqCreateValueValue(v);
								                                }, 0);
								                                return null;
								                              }}
							                            />
							                          </label>
							                        );
							                      })()}
							                    </div>
							                  ) : (
							                    <div className="text-xs text-on-surface-variant opacity-80">{row.itemNameId ? '-' : 'Select Item Name'}</div>
							                  )}
                                      </div>
                                    );
                                  })}
	                              <div className="px-2 py-2 border-r border-outline-variant space-y-1">
	                                <SearchableSelect
	                                  value={row.priorityId}
	                                  options={orderedPriorities.map((p) => ({ value: p.id, label: p.name }))}
	                                  onChange={(v) => setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, priorityId: v } : p)))}
	                                  placeholder={loadingPriorities ? 'Loading...' : 'Select'}
	                                  disabled={loadingPriorities}
	                                  allowClear
	                                />
	                              </div>
								                <div className="px-2 py-2 border-r border-outline-variant space-y-1">
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
							                <div className="px-2 py-2 flex justify-end">
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
							            );
							          })}
                              </div>
                            </div>
										          <div className="border-t border-outline-variant bg-surface-container-lowest px-2 py-2 flex items-center justify-between gap-3">
									            <div className="flex items-center gap-3">
										              <button
									                type="button"
									                className="btn-primary"
									                onClick={() => setItems((prev) => [...prev, { itemNameId: '', quantity: '', priorityId: '', specs: {} }])}
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
						                  const usedKeys = new Set<string>();
						                  const normalizedItems = items
						                    .map((it, i) => {
						                      const itemNameId = String(it.itemNameId ?? '').trim();
						                      const quantityNumber = Number(it.quantity);
						                      const specIds = itemNameId ? getItemNameSpecIds(itemNameId) : [];
						                      const specsObj: Record<string, string> = {};
						                      for (const specId of specIds) {
						                        const v = String(it.specs?.[specId] ?? '').trim();
						                        if (v) specsObj[specId] = v;
						                      }

						                      if (!itemNameId) rowMessages[i] = 'Select Item Name.';
						                      else if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) rowMessages[i] = 'Enter valid Qty.';
						                      else {
						                        const missing = specIds.find((sid) => !String(specsObj[sid] ?? '').trim());
						                        if (missing) rowMessages[i] = `Select ${specNameById?.[missing] ?? 'specification'} value.`;
						                      }

						                      const dedupeKey = itemNameId ? `${itemNameId}:${JSON.stringify(specsObj)}` : '';
						                      if (itemNameId && usedKeys.has(dedupeKey)) rowMessages[i] = 'Duplicate item specification row.';
						                      if (dedupeKey) usedKeys.add(dedupeKey);
						                      return { itemNameId, quantity: quantityNumber, priorityId: String(it.priorityId ?? '').trim() || null, specs: specsObj };
						                    })
						                    .filter((_, i) => !rowMessages[i]);
						                  setItemRowErrors(rowMessages);

								                  const department = '';
								                  const requestedBy = users.find((u) => u.id === requestedByUserId)?.name ?? '';
								                  const store = stores.find((s) => s.id === storeId)?.name ?? '';
								                  if (!firmId || !store.trim() || !requestedBy.trim() || !requiredDate.trim() || !normalizedItems.length) {
								                    setError('Please fill Firm, Store, Requested By, Required Date, and at least one valid item.');
								                    return;
			                  }
							                  if (requestType === 'Project' && !projectId.trim()) {
							                    setError('Please select a Project Name for Project-type requisitions.');
							                    return;
							                  }

					                  setSaving(true);
						                  createPurchaseRequest({
						                    firmId,
						                    requestType,
						                    projectId: requestType === 'Project' ? projectId.trim() : null,
						                    store,
						                    department,
						                    requestedBy,
						                    requiredDate,
						                    items: normalizedItems,
						                  })
				                    .then((created) => onCreated(created.pr.id))
				                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
				                    .finally(() => setSaving(false));
				                }}
							                className="btn-primary"
							                disabled={saving || !canSubmit}
							              >
						                {saving ? (
						                  <span className="inline-flex items-center gap-2">
						                    <Spinner className="h-3 w-3" />
						                    Creating...
						                  </span>
						                ) : (
						                  'Create'
						                )}
						              </button>
										          </div>
										        </div>
                        <div className="text-sm text-red-600 font-semibold px-1">Note: It is mandatory to fill all specifications.</div>
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
			                    <div className="fixed inset-0 z-[30000] flex items-center justify-center p-4">
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
			                    <div className="fixed inset-0 z-[30000] flex items-center justify-center p-4">
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
			                    <div className="fixed inset-0 z-[30000] flex items-center justify-center p-4">
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

					              {reqCreateValueRowIndex != null
					                ? createPortal(
					                    <div className="fixed inset-0 z-[40000] flex items-center justify-center p-4">
					                      <button
					                        type="button"
					                        className="absolute inset-0 bg-black/40"
					                        aria-label="Close"
					                        onClick={closeReqCreateValue}
					                      />
					                      <div className="relative w-full max-w-4xl bg-white rounded-lg border border-black shadow-xl">
					                        <div className="flex items-center justify-between px-6 py-4 border-b border-black">
					                          <div className="text-sm font-bold text-black">Add Spec Value</div>
					                          <button type="button" className="btn-primary" onClick={closeReqCreateValue}>
					                            Close
					                          </button>
					                        </div>
					                        <div className="p-6 space-y-3">
					                          {reqCreateValueError ? <div className="text-xs text-red-600">{reqCreateValueError}</div> : null}
					                          <label className="space-y-1 block">
					                            <div className="text-[10px] font-bold text-black uppercase tracking-wider">Item Name</div>
					                            <SearchableSelect
					                              value={(() => {
					                                const idx = reqCreateValueRowIndex;
					                                return idx != null ? String(items[idx]?.itemNameId ?? '') : '';
					                              })()}
					                              options={itemNames.map((n) => ({ value: n.id, label: n.name }))}
					                              onChange={() => {}}
					                              placeholder="Select item name..."
					                              disabled
					                            />
					                          </label>
					                          <label className="space-y-1 block">
					                            <div className="text-[10px] font-bold text-black uppercase tracking-wider">Specification</div>
					                            <SearchableSelect
					                              value={reqCreateValueSpecId}
					                              options={specs.map((s) => ({ value: s.id, label: s.name }))}
					                              onChange={() => {}}
					                              placeholder="Search specification..."
					                              disabled
					                            />
					                          </label>
					                          <label className="space-y-1 block">
					                            <div className="text-[10px] font-bold text-black uppercase tracking-wider">Value</div>
					                            <input
					                              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
					                              autoFocus
					                              value={reqCreateValueValue}
					                              placeholder="M12"
					                              onChange={(e) => setReqCreateValueValue(e.target.value)}
					                              onKeyDown={(e) => {
					                                if (e.key === 'Escape') closeReqCreateValue();
					                                if (e.key === 'Enter') submitReqCreateValue();
					                              }}
					                            />
					                          </label>
					                          <div className="flex justify-end gap-2 pt-1">
					                            <button type="button" className="btn-primary" onClick={closeReqCreateValue}>
					                              Cancel
					                            </button>
					                            <button
					                              type="button"
					                              className="btn-primary"
					                              disabled={reqCreateValueBusy || !reqCreateValueValue.trim()}
					                              onClick={submitReqCreateValue}
					                            >
					                              {reqCreateValueBusy ? 'Adding...' : 'Add'}
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
                          setCreateItemNameInlineUnitId('');
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
			                                  itemNameId: String(updatedOrCreated.itemNameId ?? ''),
			                                  specs: (() => {
			                                    try {
			                                      const obj = JSON.parse(String(updatedOrCreated.specificationsJson ?? '{}'));
			                                      return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
			                                    } catch {
			                                      return {};
			                                    }
			                                  })(),
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
