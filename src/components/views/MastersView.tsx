import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import {
  createFirm,
  createItem,
  createItemName,
	  createSpecification,
	  createSpecificationValue,
	  createStore,
	  createSupplier,
	  createUser,
	  deleteFirm,
	  deleteItem,
	  deleteItemName,
	  deleteSpecification,
	  deleteSpecificationValue,
	  deleteStore,
	  deleteSupplier,
	  deleteUser,
	  fetchFirms,
	  fetchItemNames,
	  fetchItems,
	  fetchSpecifications,
	  fetchSpecificationValues,
	  fetchStores,
	  fetchSuppliers,
	  fetchUsers,
	  type Firm,
	  type Item,
	  type ItemName,
	  type Specification,
	  type SpecificationValue,
	  type Store,
	  type Supplier,
	  type User,
	  updateFirm,
	  updateItem,
	  updateItemName,
	  updateSpecification,
	  updateSpecificationValue,
	  updateStore,
	  updateSupplier,
	  updateUser,
	} from '@/src/lib/masters';

import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

function formatSpecsForDisplay(specificationsJson: string) {
  try {
    const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (!entries.length) return '';
    return entries.map(([k, v]) => `${k}: ${String(v ?? '')}`).join('\n');
  } catch {
    return specificationsJson;
  }
}

function formatItemInline(itemName: string, specificationsJson: string) {
  const specs = formatSpecsForDisplay(specificationsJson)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [itemName, ...specs].join(' - ');
}

export default function MastersView({
  tab: externalTab,
  onTabChange,
}: {
  tab?: MastersTab;
  onTabChange?: (tab: MastersTab) => void;
}) {
  const [tab, setTab] = useState<MastersTab>(externalTab ?? 'firms');
  const [addOpen, setAddOpen] = useState(false);
  const [editCtx, setEditCtx] = useState<{ tab: MastersTab; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

	  const [firms, setFirms] = useState<Firm[]>([]);
	  const [stores, setStores] = useState<Store[]>([]);
	  const [users, setUsers] = useState<User[]>([]);
	  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
	  const [itemNames, setItemNames] = useState<ItemName[]>([]);
	  const [specs, setSpecs] = useState<Specification[]>([]);
	  const [specValues, setSpecValues] = useState<SpecificationValue[]>([]);
	  const [items, setItems] = useState<Item[]>([]);

	  const [newFirmName, setNewFirmName] = useState('');
	  const [newStoreFirmId, setNewStoreFirmId] = useState('');
	  const [newStoreName, setNewStoreName] = useState('');
	  const [newUserName, setNewUserName] = useState('');
	  const [newUserEmail, setNewUserEmail] = useState('');
	  const [newUserDesignation, setNewUserDesignation] = useState('');
		  const [newUserPassword, setNewUserPassword] = useState('');
		  const [newUserMobile, setNewUserMobile] = useState('');
		  const [newSupplierName, setNewSupplierName] = useState('');
		  const [newSupplierPaymentTerms, setNewSupplierPaymentTerms] = useState('');
		  const [newItemName, setNewItemName] = useState('');
		  const [newSpecName, setNewSpecName] = useState('');
	  const [specIdForValues, setSpecIdForValues] = useState('');
	  const [newSpecValue, setNewSpecValue] = useState('');
	  const [newSpecValueSpecId, setNewSpecValueSpecId] = useState('');

  const [newItemItemNameId, setNewItemItemNameId] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemSpecs, setNewItemSpecs] = useState<Array<{ specificationId: string; value: string; useCustom?: boolean }>>([
    { specificationId: '', value: '', useCustom: false },
  ]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});

  const selectedSpec = useMemo(() => specs.find((s) => s.id === specIdForValues) ?? null, [specIdForValues, specs]);
  const specNameById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);
  const specIdByName = useMemo(() => Object.fromEntries(specs.map((s) => [s.name, s.id])), [specs]);
  const groupedSpecValues = useMemo(() => {
    const map = new Map<string, { specId: string; specName: string; values: Array<{ id: string; value: string }> }>();
    for (const row of specValues) {
      const specId = row.specificationId;
      const specName = specNameById[specId] ?? specId;
      const entry = map.get(specId) ?? { specId, specName, values: [] };
      entry.values.push({ id: row.id, value: row.value });
      map.set(specId, entry);
    }
    const list = Array.from(map.values());
    list.forEach((r) => r.values.sort((a, b) => a.value.localeCompare(b.value)));
    list.sort((a, b) => a.specName.localeCompare(b.specName));
    return list;
  }, [specNameById, specValues]);

  useEffect(() => {
    if (!externalTab) return;
    setTab(externalTab);
  }, [externalTab]);

	  useEffect(() => {
	    setAddOpen(false);
	    setEditCtx(null);
	  }, [tab]);

	  const closeModal = () => {
	    setAddOpen(false);
	    setEditCtx(null);
	  };

		  const openAddModal = () => {
		    setEditCtx(null);
		    setError(null);
		    if (tab === 'firms') setNewFirmName('');
		    if (tab === 'stores') setNewStoreName('');
		    if (tab === 'users') {
		      setNewUserName('');
		      setNewUserEmail('');
		      setNewUserDesignation('');
		      setNewUserPassword('');
		      setNewUserMobile('');
		    }
			    if (tab === 'suppliers') {
			      setNewSupplierName('');
			      setNewSupplierPaymentTerms('');
			    }
		    if (tab === 'itemNames') setNewItemName('');
		    if (tab === 'specs') setNewSpecName('');
		    if (tab === 'specValues') {
		      setNewSpecValue('');
	      setNewSpecValueSpecId(specIdForValues || specs[0]?.id || '');
	    }
	    if (tab === 'items') {
	      setNewItemUnit('');
	      setNewItemDescription('');
	      setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
	    }
	    setAddOpen(true);
	  };

		  const openEditModal = (id: string) => {
		    setError(null);
		    setEditCtx({ tab, id });
		    if (tab === 'firms') {
		      const row = firms.find((f) => f.id === id);
		      setNewFirmName(row?.name ?? '');
		    }
		    if (tab === 'stores') {
		      const row = stores.find((s) => s.id === id);
		      if (row) {
		        setNewStoreFirmId(row.firmId);
		        setNewStoreName(row.name);
		      }
		    }
		    if (tab === 'users') {
		      const row = users.find((u) => u.id === id);
		      if (row) {
		        setNewUserName(row.name ?? '');
		        setNewUserEmail(row.email ?? '');
		        setNewUserDesignation(row.designation ?? '');
		        setNewUserPassword('');
		        setNewUserMobile(row.mobile ?? '');
		      }
		    }
			    if (tab === 'suppliers') {
			      const row = suppliers.find((s) => s.id === id);
			      setNewSupplierName(row?.name ?? '');
			      setNewSupplierPaymentTerms(row?.paymentTerms ?? '');
			    }
	    if (tab === 'itemNames') {
	      const row = itemNames.find((n) => n.id === id);
	      setNewItemName(row?.name ?? '');
	    }
	    if (tab === 'specs') {
	      const row = specs.find((s) => s.id === id);
	      setNewSpecName(row?.name ?? '');
	    }
	    if (tab === 'specValues') {
	      const row = specValues.find((v) => v.id === id);
	      if (row) {
	        setNewSpecValueSpecId(row.specificationId);
	        setNewSpecValue(row.value);
	      }
	    }
	    if (tab === 'items') {
	      const row = items.find((it) => it.id === id);
	      if (row) {
	        setNewItemItemNameId(row.itemNameId);
	        setNewItemUnit(row.unit ?? '');
	        setNewItemDescription(row.description ?? '');
	        try {
	          const obj = JSON.parse(row.specificationsJson) as Record<string, unknown>;
	          const next = Object.entries(obj)
	            .map(([k, v]) => ({
	              specificationId: specIdByName[k] ?? '',
	              value: String(v ?? ''),
	              useCustom: false,
	            }))
	            .filter((r) => r.value.trim());
	          setNewItemSpecs(next.length ? next : [{ specificationId: '', value: '', useCustom: false }]);
	          next.forEach((r) => {
	            if (!r.specificationId) return;
	            fetchSpecificationValues(r.specificationId)
	              .then((vals) => setSpecValueOptions((m) => ({ ...m, [r.specificationId]: vals })))
	              .catch(() => {});
	          });
	        } catch {
	          setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
	        }
	      }
	    }
	    setAddOpen(true);
	  };

		  const addTitle = useMemo(() => {
		    const verb = editCtx?.tab === tab ? 'Edit' : 'Add';
		    switch (tab) {
		      case 'firms':
		        return `${verb} Firm`;
		      case 'stores':
		        return `${verb} Store`;
		      case 'users':
		        return `${verb} User`;
		      case 'suppliers':
		        return `${verb} Supplier`;
		      case 'itemNames':
		        return `${verb} Item Name`;
		      case 'specs':
	        return `${verb} Specification`;
	      case 'specValues':
	        return `${verb} Spec Value`;
	      case 'items':
	        return `${verb} Item`;
	      default:
	        return verb;
	    }
	  }, [editCtx?.tab, tab]);

	  const isEditing = editCtx?.tab === tab && Boolean(editCtx?.id);

		  function loadAll(signal?: AbortSignal) {
		    setError(null);
		    return Promise.all([
		      fetchFirms(signal),
		      fetchStores(signal),
		      fetchUsers(signal),
	      fetchSuppliers(signal),
	      fetchItemNames(signal),
	      fetchSpecifications(signal),
	      fetchItems(signal),
	    ]).then(([f, st, u, sup, inames, sp, it]) => {
	      setFirms(f);
	      setStores(st);
	      setUsers(u);
	      setSuppliers(sup);
		      setItemNames(inames);
		      setSpecs(sp);
		      setItems(it);
		      setNewStoreFirmId((prev) => prev || f[0]?.id || '');
	      setNewItemItemNameId((prev) => prev || inames[0]?.id || '');
	      return { firms: f, specifications: sp };
	    });
	  }

  useEffect(() => {
    const ac = new AbortController();
    loadAll(ac.signal).catch((e) => {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => ac.abort();
  }, []);

	  useEffect(() => {
	    const ac = new AbortController();
	    if (!specs.length) {
	      setSpecValues([]);
	      return () => ac.abort();
	    }
	
	    const run = async () => {
	      if (specIdForValues) {
	        const rows = await fetchSpecificationValues(specIdForValues, ac.signal);
	        setSpecValues(rows);
	        return;
	      }
	
	      const all = await Promise.all(specs.map((s) => fetchSpecificationValues(s.id, ac.signal)));
	      const flat = all
	        .flat()
	        .sort((a, b) => {
	          const an = specNameById[a.specificationId] ?? '';
	          const bn = specNameById[b.specificationId] ?? '';
	          if (an !== bn) return an.localeCompare(bn);
	          return a.value.localeCompare(b.value);
	        });
	      setSpecValues(flat);
	    };
	
	    run().catch((e) => {
	      if (ac.signal.aborted) return;
	      setError(e instanceof Error ? e.message : String(e));
	    });
	    return () => ac.abort();
	  }, [specIdForValues, specs, specNameById]);
	
	  useEffect(() => {
	    if (!addOpen) return;
	    if (tab !== 'specValues') return;
	    setNewSpecValueSpecId((prev) => prev || specIdForValues || specs[0]?.id || '');
	  }, [addOpen, specIdForValues, specs, tab]);

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-headline font-bold text-sm text-on-surface">All Masters</h3>
            <p className="text-sm text-on-surface-variant">Maintain Firms, Stores, Suppliers, Items and Specifications.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              onClick={() => {
                window.location.href = '/api/requests.xlsx';
              }}
            >
              Download Excel
            </button>
            <button
              type="button"
              className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              onClick={() => {
                window.location.href = '/api/masters.xlsx';
              }}
            >
              Download Masters Excel
            </button>
          </div>
        </div>

        {error ? <div className="mt-3 text-xs text-error">{error}</div> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {MASTERS_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={
              key === tab
                ? 'px-3 py-2 text-xs font-semibold rounded-lg bg-surface-container-highest text-on-surface'
                : 'px-3 py-2 text-xs font-semibold rounded-lg text-on-surface-variant hover:bg-surface-container-high'
            }
            onClick={() => {
              setTab(key);
              onTabChange?.(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

	      {addOpen ? (
	        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
	          <button
	            type="button"
	            className="absolute inset-0 bg-black/40"
	            aria-label="Close"
	            onClick={closeModal}
	          />
	          <div className="relative w-full max-w-3xl bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-xl max-h-[85vh] overflow-auto">
	            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
	              <div className="text-sm font-bold text-on-surface">{addTitle}</div>
	              <button
	                type="button"
	                className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                onClick={closeModal}
	              >
	                Close
	              </button>
	            </div>

            <div className="p-5 space-y-3">
	              {tab === 'firms' ? (
	                <div className="space-y-2">
	                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm name</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newFirmName}
                      onChange={(e) => setNewFirmName(e.target.value)}
	                      placeholder="Umang (Main)"
	                    />
	                  </label>
		                  <div className="flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                      onClick={() => {
		                        setNewFirmName('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newFirmName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
	                        const fn = isEditing
	                          ? updateFirm(editCtx?.id ?? '', { name: newFirmName.trim(), updatedBy: 'system' })
	                          : createFirm({ name: newFirmName.trim(), createdBy: 'system' });
	                        fn
	                          .then(() => loadAll())
	                          .then(() => {
	                            setNewFirmName('');
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
		                  </div>
                </div>
              ) : null}

	              {tab === 'stores' ? (
	                <div className="space-y-2">
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm</div>
		                    <SearchableSelect
		                      value={newStoreFirmId}
		                      options={firms.map((f) => ({ value: f.id, label: f.name }))}
		                      onChange={setNewStoreFirmId}
		                      placeholder="Search firm..."
		                    />
		                  </label>
	                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Store name</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newStoreName}
	                      onChange={(e) => setNewStoreName(e.target.value)}
	                      placeholder="Main Store"
	                    />
	                  </label>
		                  <div className="flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                      onClick={() => {
		                        setNewStoreName('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={!newStoreFirmId || !newStoreName.trim() || busy}
	                      onClick={() => {
	                        setBusy(true);
	                        setError(null);
	                        const fn = isEditing
	                          ? updateStore(editCtx?.id ?? '', {
	                              firmId: newStoreFirmId,
	                              name: newStoreName.trim(),
	                              updatedBy: 'system',
	                            })
	                          : createStore({ firmId: newStoreFirmId, name: newStoreName.trim(), createdBy: 'system' });
	                        fn.then(() => loadAll())
	                          .then(() => {
	                            setNewStoreName('');
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
		                  </div>
	                </div>
	              ) : null}

	              {tab === 'users' ? (
	                <div className="space-y-3">
	                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Name</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newUserName}
	                        onChange={(e) => setNewUserName(e.target.value)}
	                        placeholder="Marcus Chen"
	                      />
	                    </label>
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newUserEmail}
	                        onChange={(e) => setNewUserEmail(e.target.value)}
	                        placeholder="marcus@example.com"
	                      />
	                    </label>
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Designation</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newUserDesignation}
	                        onChange={(e) => setNewUserDesignation(e.target.value)}
	                        placeholder="Procurement Manager"
	                      />
	                    </label>
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newUserMobile}
	                        onChange={(e) => setNewUserMobile(e.target.value)}
	                        placeholder="9876543210"
	                      />
	                    </label>
	                  </div>

	                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Password</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newUserPassword}
	                      onChange={(e) => setNewUserPassword(e.target.value)}
	                      type="password"
	                      placeholder={isEditing ? 'Leave blank to keep unchanged' : 'Set password'}
	                    />
	                  </label>

	                  <div className="flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                      onClick={() => {
	                        setNewUserName('');
	                        setNewUserEmail('');
	                        setNewUserDesignation('');
	                        setNewUserPassword('');
	                        setNewUserMobile('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={
	                        busy ||
	                        !newUserName.trim() ||
	                        !newUserEmail.trim() ||
	                        !newUserDesignation.trim() ||
	                        (!isEditing && !newUserPassword.trim())
	                      }
	                      onClick={() => {
	                        setBusy(true);
	                        setError(null);
	                        const password = newUserPassword.trim();
	                        const fn = isEditing
	                          ? updateUser(editCtx?.id ?? '', {
	                              name: newUserName.trim(),
	                              email: newUserEmail.trim(),
	                              designation: newUserDesignation.trim(),
	                              mobile: newUserMobile.trim() || undefined,
	                              password: password || undefined,
	                              updatedBy: 'system',
	                            })
	                          : createUser({
	                              name: newUserName.trim(),
	                              email: newUserEmail.trim(),
	                              designation: newUserDesignation.trim(),
	                              mobile: newUserMobile.trim() || undefined,
	                              password,
	                              createdBy: 'system',
	                            });
	                        fn.then(() => loadAll())
	                          .then(() => {
	                            setNewUserName('');
	                            setNewUserEmail('');
	                            setNewUserDesignation('');
	                            setNewUserPassword('');
	                            setNewUserMobile('');
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
	                </div>
	              ) : null}

			              {tab === 'suppliers' ? (
			                <div className="space-y-2">
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Supplier name</div>
			                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newSupplierName}
	                      onChange={(e) => setNewSupplierName(e.target.value)}
		                      placeholder="ABC Traders"
		                    />
		                  </label>
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Payment Terms</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newSupplierPaymentTerms}
		                      onChange={(e) => setNewSupplierPaymentTerms(e.target.value)}
		                      placeholder="30 days"
		                    />
		                  </label>
			                  <div className="flex justify-end gap-2">
			                    <button
			                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                      onClick={() => {
			                        setNewSupplierName('');
			                        setNewSupplierPaymentTerms('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newSupplierName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
		                        const fn = isEditing
		                          ? updateSupplier(editCtx?.id ?? '', {
		                              name: newSupplierName.trim(),
		                              paymentTerms: newSupplierPaymentTerms.trim() || undefined,
		                              updatedBy: 'system',
		                            })
		                          : createSupplier({
		                              name: newSupplierName.trim(),
		                              paymentTerms: newSupplierPaymentTerms.trim() || undefined,
		                              createdBy: 'system',
		                            });
		                        fn.then(() => loadAll())
		                          .then(() => {
		                            setNewSupplierName('');
		                            setNewSupplierPaymentTerms('');
		                            closeModal();
		                          })
		                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
		                          .finally(() => setBusy(false));
		                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
                </div>
              ) : null}

	              {tab === 'itemNames' ? (
	                <div className="space-y-2">
	                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item name</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
	                      placeholder="Bolt"
	                    />
	                  </label>
		                  <div className="flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                      onClick={() => {
		                        setNewItemName('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={!newItemName.trim() || busy}
	                      onClick={() => {
	                        setBusy(true);
	                        setError(null);
	                        const fn = isEditing
	                          ? updateItemName(editCtx?.id ?? '', { name: newItemName.trim(), updatedBy: 'system' })
	                          : createItemName({ name: newItemName.trim(), createdBy: 'system' });
	                        fn.then(() => loadAll())
	                          .then(() => {
	                            setNewItemName('');
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
                </div>
              ) : null}

	              {tab === 'specs' ? (
	                <div className="space-y-2">
	                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specification name</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newSpecName}
                      onChange={(e) => setNewSpecName(e.target.value)}
	                      placeholder="Size"
	                    />
	                  </label>
		                  <div className="flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                      onClick={() => {
		                        setNewSpecName('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={!newSpecName.trim() || busy}
	                      onClick={() => {
	                        setBusy(true);
	                        setError(null);
	                        const fn = isEditing
	                          ? updateSpecification(editCtx?.id ?? '', { name: newSpecName.trim(), updatedBy: 'system' })
	                          : createSpecification({ name: newSpecName.trim(), createdBy: 'system' });
	                        fn.then(() => loadAll())
	                          .then(() => {
	                            setNewSpecName('');
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
                </div>
              ) : null}

		              {tab === 'specValues' ? (
		                <div className="space-y-2">
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specification</div>
			                    <SearchableSelect
			                      value={newSpecValueSpecId}
			                      options={specs.map((s) => ({ value: s.id, label: s.name }))}
			                      onChange={setNewSpecValueSpecId}
			                      placeholder="Search specification..."
			                      onCreate={async (label) => {
			                        const name = label.trim();
			                        if (!name) return null;
			                        const created = await createSpecification({ name, createdBy: 'system' });
			                        const next = created.specification;
			                        if (!next?.id) return null;
			                        await loadAll();
			                        setNewSpecValueSpecId(next.id);
			                        return { value: next.id, label: next.name };
			                      }}
			                    />
			                  </label>
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Value</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newSpecValue}
                      onChange={(e) => setNewSpecValue(e.target.value)}
	                      placeholder="M12"
	                    />
		                    </label>
			                  <div className="flex justify-end gap-2">
			                    <button
			                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                      onClick={() => {
		                        setNewSpecValue('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
			                    </button>
			                    <button
			                      type="button"
			                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                      disabled={!newSpecValueSpecId || !newSpecValue.trim() || busy}
			                      onClick={() => {
			                        setBusy(true);
			                        setError(null);
			                        const fn = isEditing
			                          ? updateSpecificationValue(editCtx?.id ?? '', {
			                              specificationId: newSpecValueSpecId,
			                              value: newSpecValue.trim(),
			                              updatedBy: 'system',
			                            })
			                          : createSpecificationValue({ specificationId: newSpecValueSpecId, value: newSpecValue.trim(), createdBy: 'system' });
			                        fn
			                          .then(() => fetchSpecificationValues(newSpecValueSpecId))
			                          .then((vals) => {
			                            setSpecValueOptions((m) => ({ ...m, [newSpecValueSpecId]: vals }));
			                          })
		                          .then(async () => {
		                            if (specIdForValues) {
		                              const rows = await fetchSpecificationValues(specIdForValues);
		                              setSpecValues(rows);
		                              return;
		                            }
		                            const all = await Promise.all(specs.map((s) => fetchSpecificationValues(s.id)));
		                            const flat = all
		                              .flat()
		                              .sort((a, b) => {
		                                const an = specNameById[a.specificationId] ?? '';
		                                const bn = specNameById[b.specificationId] ?? '';
		                                if (an !== bn) return an.localeCompare(bn);
		                                return a.value.localeCompare(b.value);
		                              });
		                            setSpecValues(flat);
			                          })
			                          .then(() => {
			                            setNewSpecValue('');
			                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
                </div>
              ) : null}

	              {tab === 'items' ? (
	                <div className="space-y-3">
	                  <div className="space-y-2">
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Name</div>
		                      <SearchableSelect
		                        value={newItemItemNameId}
		                        options={itemNames.map((n) => ({ value: n.id, label: n.name }))}
		                        onChange={setNewItemItemNameId}
		                        placeholder="Search item name..."
		                        onCreate={async (label) => {
		                          const name = label.trim();
		                          if (!name) return null;
		                          const created = await createItemName({ name, createdBy: 'system' });
		                          const next = created.itemName;
		                          if (!next?.id) return null;
		                          await loadAll();
		                          setNewItemItemNameId(next.id);
		                          return { value: next.id, label: next.name };
		                        }}
		                      />
		                    </label>
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit (optional)</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newItemUnit}
	                        onChange={(e) => setNewItemUnit(e.target.value)}
	                        placeholder="Nos"
	                      />
	                    </label>
	                    <label className="space-y-1">
	                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Description (optional)</div>
	                      <input
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newItemDescription}
	                        onChange={(e) => setNewItemDescription(e.target.value)}
	                        placeholder="High tensile"
	                      />
	                    </label>
	                  </div>
	
	                  <div className="space-y-2">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specifications</div>
	                    {newItemSpecs.map((row, idx) => (
	                      <div
	                        key={idx}
	                        className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-3 space-y-2"
	                      >
	                        <div className="flex items-center justify-between gap-2">
	                          <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
	                            Spec Row {idx + 1}
	                          </div>
	                          <button
	                            type="button"
	                            className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors disabled:opacity-50"
	                            disabled={newItemSpecs.length === 1}
	                            onClick={() => setNewItemSpecs((prev) => prev.filter((_, i) => i !== idx))}
	                            title={newItemSpecs.length === 1 ? 'At least one specification required' : 'Remove'}
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
		                              setNewItemSpecs((prev) =>
		                                prev.map((p, i) =>
		                                  i === idx ? { ...p, specificationId: specId, value: '', useCustom: false } : p
		                                )
		                              );
		                              if (!specId) return;
		                              fetchSpecificationValues(specId)
		                                .then((vals) => setSpecValueOptions((m) => ({ ...m, [specId]: vals })))
		                                .catch(() => {});
			                            }}
			                            placeholder="Search specification..."
			                            createLabel={(q) => `+ Create Specification "${q}"`}
			                            onCreate={async (label) => {
			                              const name = label.trim();
			                              if (!name) return null;
			                              const created = await createSpecification({ name, createdBy: 'system' });
		                              const next = created.specification;
		                              if (!next?.id) return null;
		                              await loadAll();
		                              return { value: next.id, label: next.name };
		                            }}
		                          />
		                        </label>
	
		                        <label className="space-y-1">
		                          <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Value</div>
			                          <SearchableSelect
			                            value={row.value}
		                            options={(() => {
		                              const opts = (specValueOptions[row.specificationId] ?? []).map((v) => ({
		                                value: v.value,
		                                label: v.value,
		                              }));
		                              if (row.value && !opts.some((o) => o.value === row.value)) {
		                                return [{ value: row.value, label: row.value }, ...opts];
		                              }
		                              return opts;
		                            })()}
			                            onChange={(v) => setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, value: v } : p)))}
			                            disabled={!row.specificationId}
			                            placeholder={row.specificationId ? 'Search or type value...' : 'Select spec first'}
			                            createLabel={(q) => `+ Add Value "${q}"`}
			                            onCreate={async (label) => {
			                              const v = label.trim();
			                              if (!v) return null;
			                              if (!row.specificationId) return null;
			                              try {
			                                const created = await createSpecificationValue({
			                                  specificationId: row.specificationId,
			                                  value: v,
			                                  createdBy: 'system',
			                                });
			                                const next = created.specificationValue;
			                                if (next) {
			                                  setSpecValueOptions((m) => {
			                                    const prev = m[row.specificationId] ?? [];
			                                    if (prev.some((p) => p.value === next.value)) return m;
			                                    return { ...m, [row.specificationId]: [...prev, next] };
			                                  });
			                                  return { value: next.value, label: next.value };
			                                }
			                              } catch {
			                                // fall back to local-only addition
			                              }
			                              setSpecValueOptions((m) => {
			                                const prev = m[row.specificationId] ?? [];
			                                if (prev.some((p) => p.value === v)) return m;
			                                return {
			                                  ...m,
			                                  [row.specificationId]: [
			                                    ...prev,
			                                    { id: `NEW-${Date.now()}-${Math.random()}`, specificationId: row.specificationId, value: v, isActive: true },
			                                  ],
			                                };
			                              });
			                              return { value: v, label: v };
			                            }}
			                          />
			                        </label>
	                      </div>
	                    ))}

                    <button
                      type="button"
                      className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
                      onClick={() => setNewItemSpecs((prev) => [...prev, { specificationId: '', value: '', useCustom: false }])}
                    >
                      + Add Spec Row
                    </button>
                  </div>

	                  <div className="flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
	                      onClick={() => {
	                        setNewItemUnit('');
	                        setNewItemDescription('');
	                        setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                      disabled={
                        busy ||
                        !newItemItemNameId ||
                        newItemSpecs.filter((s) => s.specificationId.trim() && s.value.trim()).length === 0
                      }
	                      onClick={() => {
	                        setBusy(true);
	                        setError(null);
	                        const fn = isEditing
	                          ? updateItem(editCtx?.id ?? '', {
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
	                        fn
	                          .then(() => fetchItems().then(setItems))
	                          .then(() => {
	                            setNewItemUnit('');
	                            setNewItemDescription('');
	                            setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
	                            closeModal();
	                          })
	                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

		      {tab === 'firms' ? (
		        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
		          <div className="flex items-center justify-between gap-2">
		            <div className="text-sm text-on-surface-variant">Total: {firms.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
			            <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
			              </thead>
			              <tbody>
			                {firms.map((f) => (
			                  <tr key={f.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{f.name}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(f.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete firm "${f.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteFirm(f.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
		          </div>
	        </div>
	      ) : null}

		      {tab === 'stores' ? (
		        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
		          <div className="flex items-center justify-between gap-2">
		            <div className="text-sm text-on-surface-variant">Total: {stores.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
			            <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Firm</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Location</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
			              </thead>
			              <tbody>
			                {stores.map((s) => (
			                  <tr key={s.id}>
		                    <td className="px-3 py-2 text-on-surface border border-blue-600">
		                      {firms.find((f) => f.id === s.firmId)?.name ?? s.firmId}
			                    </td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.location ?? ''}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(s.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete store "${s.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteStore(s.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
		          </div>
		        </div>
		      ) : null}

			      {tab === 'users' ? (
			        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
			          <div className="flex items-center justify-between gap-2">
			            <div className="text-sm text-on-surface-variant">Total: {users.length}</div>
			            <button
			              type="button"
			              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
			              onClick={openAddModal}
			            >
			              Add
			            </button>
			          </div>
			          <div className="overflow-auto">
			            <table className="min-w-[980px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Email</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Designation</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Password</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Mobile</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
			              </thead>
			              <tbody>
			                {users.map((u) => (
			                  <tr key={u.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.name}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{u.email ?? ''}</td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.designation}</td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.hasPassword ? '********' : ''}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{u.mobile ?? ''}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(u.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete user "${u.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteUser(u.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
			          </div>
			        </div>
			      ) : null}

			      {tab === 'suppliers' ? (
			        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
			          <div className="flex items-center justify-between gap-2">
			            <div className="text-sm text-on-surface-variant">Total: {suppliers.length}</div>
		            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
				            <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
				              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
				                <tr>
				                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">GST</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Payment Terms</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
				                </tr>
				              </thead>
				              <tbody>
				                {suppliers.map((s) => (
				                  <tr key={s.id}>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.gstNumber ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.paymentTerms ?? ''}</td>
				                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
				                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(s.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteSupplier(s.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
		          </div>
	        </div>
	      ) : null}

		      {tab === 'itemNames' ? (
		        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
		          <div className="flex items-center justify-between gap-2">
		            <div className="text-sm text-on-surface-variant">Total: {itemNames.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
			            <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Category</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
			              </thead>
			              <tbody>
			                {itemNames.map((n) => (
			                  <tr key={n.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{n.name}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{n.category ?? ''}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(n.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete item name "${n.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteItemName(n.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
		          </div>
	        </div>
	      ) : null}

		      {tab === 'specs' ? (
		        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
		          <div className="flex items-center justify-between gap-2">
		            <div className="text-sm text-on-surface-variant">Total: {specs.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
			            <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
			              </thead>
			              <tbody>
			                {specs.map((s) => (
			                  <tr key={s.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
			                          onClick={() => openEditModal(s.id)}
			                        >
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
			                          onClick={() => {
			                            if (!window.confirm(`Delete specification "${s.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteSpecification(s.id, { deletedBy: 'system' })
			                              .then(() => loadAll())
			                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          Delete
			                        </button>
			                      </div>
			                    </td>
			                  </tr>
			                ))}
			              </tbody>
			            </table>
		          </div>
	        </div>
	      ) : null}

	      {tab === 'specValues' ? (
	        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
		          <label className="space-y-1">
		            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specification</div>
		            <SearchableSelect
		              value={specIdForValues}
		              options={[{ value: '', label: 'All' }, ...specs.map((s) => ({ value: s.id, label: s.name }))]}
		              onChange={setSpecIdForValues}
		              placeholder="Search specification..."
		              onCreate={async (label) => {
		                const name = label.trim();
		                if (!name) return null;
		                const created = await createSpecification({ name, createdBy: 'system' });
		                const next = created.specification;
		                if (!next?.id) return null;
		                await loadAll();
		                setSpecIdForValues(next.id);
		                return { value: next.id, label: next.name };
		              }}
		            />
		          </label>
	
	          <div className="flex items-center justify-between gap-2">
	            <div className="text-sm text-on-surface-variant">Total: {groupedSpecValues.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
	          </div>
	          <div className="overflow-auto">
		            <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
		              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
		                <tr>
		                  <th className="text-left px-3 py-2 border border-blue-600">Specification</th>
		                  <th className="text-left px-3 py-2 border border-blue-600">Values</th>
		                </tr>
		              </thead>
		              <tbody>
		                {groupedSpecValues.map((r) => (
		                  <tr key={r.specId} className="align-top">
		                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{r.specName}</td>
		                    <td className="px-3 py-2 text-on-surface border border-blue-600 break-words">
		                      <ul className="list-disc pl-5 space-y-0.5">
		                        {r.values.map((v) => (
		                          <li key={v.id} className="whitespace-pre-wrap flex items-start justify-between gap-2">
		                            <span>{v.value}</span>
		                            <span className="flex items-center gap-1 whitespace-nowrap">
		                              <button
		                                type="button"
		                                className="px-2 py-1 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                                onClick={() => openEditModal(v.id)}
		                              >
		                                Edit
		                              </button>
		                              <button
		                                type="button"
		                                className="px-2 py-1 text-[11px] font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
		                                onClick={() => {
		                                  if (!window.confirm(`Delete value "${v.value}"?`)) return;
		                                  setBusy(true);
		                                  setError(null);
		                                  deleteSpecificationValue(v.id, { deletedBy: 'system' })
		                                    .then(() => setSpecValues((prev) => prev.filter((p) => p.id !== v.id)))
		                                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
		                                    .finally(() => setBusy(false));
		                                }}
		                              >
		                                Delete
		                              </button>
		                            </span>
		                          </li>
		                        ))}
		                      </ul>
		                    </td>
		                  </tr>
		                ))}
		              </tbody>
		            </table>
	          </div>
	        </div>
	      ) : null}

	      {tab === 'items' ? (
	        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
	          <div className="flex items-center justify-between gap-2">
	            <div className="text-sm text-on-surface-variant">Total: {items.length}</div>
	            <button
	              type="button"
	              className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors"
	              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
		          <div className="overflow-auto">
		            <table className="min-w-[980px] w-full text-sm border-collapse border border-blue-600">
		              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
		                <tr>
		                  <th className="text-left px-3 py-2 border border-blue-600">Item Name</th>
		                  <th className="text-left px-3 py-2 border border-blue-600">Item</th>
		                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
		                </tr>
		              </thead>
		              <tbody>
			                {items.map((it) => (
			                  <tr key={it.id} className="align-top">
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{it.itemName}</td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600 break-words max-w-[420px]">
			                      {formatItemInline(it.itemName, it.specificationsJson)}
			                    </td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button
		                          type="button"
		                          className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
		                          onClick={() => openEditModal(it.id)}
		                        >
		                          Edit
		                        </button>
		                        <button
		                          type="button"
		                          className="px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/30 rounded-lg transition-colors"
		                          onClick={() => {
		                            if (!window.confirm(`Delete item "${it.itemName}"?`)) return;
		                            setBusy(true);
		                            setError(null);
		                            deleteItem(it.id, { deletedBy: 'system' })
		                              .then(() => fetchItems().then(setItems))
		                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
		                              .finally(() => setBusy(false));
		                          }}
		                        >
		                          Delete
		                        </button>
		                      </div>
		                    </td>
		                  </tr>
		                ))}
		              </tbody>
	            </table>
	          </div>
	        </div>
	      ) : null}

      {tab === 'items' ? null : null}
    </div>
  );
}
