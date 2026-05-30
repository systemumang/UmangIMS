import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import InlineCreateDialog from '@/src/components/common/InlineCreateDialog';
import { Plus, Trash2, ChevronDown, Download, Eye } from 'lucide-react';
import { downloadTextFile, parseCsv, toCsv } from '@/src/lib/csvFile';
import { formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { getSidebarPermissionItems } from '@/src/lib/sidebarMenu';
import {
  createDepartment,
  createFirm,
		  createProject,
	  createItem,
		  createUnit,
      createPriority,
		  createItemCategory,
	  createItemName,
		  createSpecification,
		  createSpecificationValue,
	  createStore,
	  createCustomer,
	  createSupplier,
	  createCity,
	  createState,
	  createTransporter,
	  createUser,
  deleteDepartment,
  deleteFirm,
	  deleteProject,
	  deleteItem,
	  deleteUnit,
    deletePriority,
	  deleteItemCategory,
	  deleteItemName,
		  deleteSpecification,
		  deleteSpecificationValue,
			  deleteStore,
	  deleteCustomer,
	  deleteSupplier,
	  deleteCity,
	  deleteState,
	  deleteTransporter,
	  deleteUser,
  fetchDepartments,
  fetchFirms,
	  fetchProjects,
	  fetchUnits,
    fetchPriorities,
	  fetchItemCategories,
	  fetchItemNames,
	  fetchItems,
		  fetchSpecifications,
		  fetchSpecificationValues,
		  fetchStores,
		  fetchSuppliers,
	  fetchCustomers,
	  fetchTransporters,
	  fetchUsers,
	  fetchCities,
	  fetchStates,
	  type Department,
	  type City,
	  type State,
	  type Firm,
	  type Project,
	  type Item,
		  type Unit,
      type Priority,
		  type ItemCategory,
	  type ItemName,
		  type Specification,
		  type SpecificationValue,
		  type Store,
		  type Supplier,
		  type Customer,
		  type Transporter,
		  type User,
  updateDepartment,
  updateFirm,
	  updateProject,
	  updateItem,
	  updateUnit,
    updatePriority,
	  updateItemCategory,
	  updateItemName,
		  updateSpecification,
		  updateSpecificationValue,
			  updateStore,
	  updateCustomer,
	  updateSupplier,
	  updateCity,
	  updateState,
	  updateTransporter,
	  updateUser,
				} from '@/src/lib/masters';

import { MASTERS_TABS, type MastersTab } from '@/src/lib/mastersTabs';

function normalizeTenDigitPhoneInput(value: string) {
  return value.replace(/\D/g, '').slice(0, 10);
}

function isValidTenDigitPhone(value: string) {
  return /^\d{10}$/.test(value);
}

function normalizeKey(value: string) {
  return String(value ?? '').trim().toLowerCase();
}

type PendingItemUploadRow = {
  itemName: string;
  description: string;
  unitName: string;
  itemCategoryName: string;
  reorderLevel: string;
  storeOpeningBalances: Array<{ storeName: string; quantity: string }>;
  specs: Array<{ specificationId: string; value: string }>;
};
type ItemUploadIssue = {
  type: 'duplicate_in_file' | 'already_exists' | 'unit_mismatch' | 'item_name_missing' | 'invalid_reorder_level' | 'create_failed';
  combination: string;
  message: string;
};
type DeleteUsageDetail = {
  usedIn: string;
  name: string;
};
function formatSpecsForDisplay(specificationsJson: string, specNameLookup?: Record<string, string>) {
  try {
    const obj = JSON.parse(specificationsJson) as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (!entries.length) return '';
    return entries
      .map(([specId, v]) => `${specNameLookup?.[specId] ?? specId}: ${String(v ?? '')}`)
      .join('\n');
  } catch {
    return specificationsJson;
  }
}

function formatItemInline(itemName: string, specificationsJson: string, specNameLookup?: Record<string, string>) {
  const specs = formatSpecsForDisplay(specificationsJson, specNameLookup)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [itemName, ...specs].join(' - ');
}

function MultiSelectFilter({
  options,
  values,
  onChange,
  controlClassName,
}: {
  options: Array<{ value: string; label: string }>;
  values: string[];
  onChange: (next: string[]) => void;
  controlClassName?: string;
}) {
  return null;
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
      const [deleteUsageDetails, setDeleteUsageDetails] = useState<DeleteUsageDetail[]>([]);
		  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
		  const [busy, setBusy] = useState(false);
      const [templateBusy, setTemplateBusy] = useState(false);
      const [templateError, setTemplateError] = useState<string | null>(null);
      const [templateInfo, setTemplateInfo] = useState<string | null>(null);
      const [itemUploadIssues, setItemUploadIssues] = useState<ItemUploadIssue[]>([]);
      const [pendingItemUploadRows, setPendingItemUploadRows] = useState<PendingItemUploadRow[] | null>(null);
      const [missingItemNames, setMissingItemNames] = useState<Array<{ name: string; unitId: string; itemCategoryId: string }>>([]);

	  const clearFieldError = (key: string) =>
	    setFieldErrors((m) => {
	      if (!m[key]) return m;
	      const next = { ...m };
	      delete next[key];
	      return next;
	    });

		  const setFieldError = (key: string, message: string) => setFieldErrors((m) => ({ ...m, [key]: message }));

      const handleMasterError = (e: unknown) => {
        const details = Array.isArray((e as any)?.usageDetails) ? (e as any).usageDetails : [];
        setDeleteUsageDetails(
          details
            .map((row: any) => ({
              usedIn: String(row?.usedIn ?? '').trim(),
              name: String(row?.name ?? '').trim(),
            }))
            .filter((row: DeleteUsageDetail) => row.usedIn || row.name)
        );
        setError(e instanceof Error ? e.message : String(e));
      };

  useEffect(() => {
    if (!addOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [addOpen]);

		  const [firms, setFirms] = useState<Firm[]>([]);
		  const [stores, setStores] = useState<Store[]>([]);
			  const [departments, setDepartments] = useState<Department[]>([]);
			  const [states, setStates] = useState<State[]>([]);
			  const [cities, setCities] = useState<City[]>([]);
					  const [users, setUsers] = useState<User[]>([]);
					  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
					  const [customers, setCustomers] = useState<Customer[]>([]);
				  const [transporters, setTransporters] = useState<Transporter[]>([]);
				  const [projects, setProjects] = useState<Project[]>([]);
			  const [units, setUnits] = useState<Unit[]>([]);
        const [priorities, setPriorities] = useState<Priority[]>([]);
			  const [itemCategories, setItemCategories] = useState<ItemCategory[]>([]);
			  const [itemNames, setItemNames] = useState<ItemName[]>([]);
			  const [specs, setSpecs] = useState<Specification[]>([]);
			  const [specValues, setSpecValues] = useState<SpecificationValue[]>([]);
				  const [items, setItems] = useState<Item[]>([]);
				  const [specValueItemNameId, setSpecValueItemNameId] = useState('');

			  const [newFirmName, setNewFirmName] = useState('');
			  const [newFirmSortName, setNewFirmSortName] = useState('');
			  const [newFirmCin, setNewFirmCin] = useState('');
			  const [newFirmGstNumber, setNewFirmGstNumber] = useState('');
			  const [newFirmAddress, setNewFirmAddress] = useState('');
			  const [newFirmPhone, setNewFirmPhone] = useState('');
			  const [newFirmLogoUrl, setNewFirmLogoUrl] = useState('');
			  const [newFirmTermsConditions, setNewFirmTermsConditions] = useState('');
					  const [newDepartmentName, setNewDepartmentName] = useState('');
					  const [newStateName, setNewStateName] = useState('');
					  const [newCityState, setNewCityState] = useState('');
					  const [newCityName, setNewCityName] = useState('');
					  const [newStoreFirmId, setNewStoreFirmId] = useState('');
				  const [newStoreName, setNewStoreName] = useState('');
				  const [newStoreLocation, setNewStoreLocation] = useState('');
			  const [newProjectFirmId, setNewProjectFirmId] = useState('');
			  const [newProjectName, setNewProjectName] = useState('');
			  const [newProjectClientName, setNewProjectClientName] = useState('');
			  const [newProjectStartDate, setNewProjectStartDate] = useState('');
		  const [newProjectEndDate, setNewProjectEndDate] = useState('');
			  const [newProjectStatus, setNewProjectStatus] = useState('');
			  const [newUserName, setNewUserName] = useState('');
			  const [newUserEmail, setNewUserEmail] = useState('');
			  const [newUserLoginId, setNewUserLoginId] = useState('');
			  const [newUserRole, setNewUserRole] = useState('');
			  const [extraUserRoles, setExtraUserRoles] = useState<string[]>([]);
			  const [newUserMenuAccess, setNewUserMenuAccess] = useState<string[]>([]);
			  const [newUserIsActive, setNewUserIsActive] = useState(true);
			  const [newUserPassword, setNewUserPassword] = useState('');
			  const [newUserMobile, setNewUserMobile] = useState('');
        const [newUserPoApprovalAmount, setNewUserPoApprovalAmount] = useState('');
					  const [newSupplierName, setNewSupplierName] = useState('');
					  const [newSupplierGstNumber, setNewSupplierGstNumber] = useState('');
					  const [newSupplierGstType, setNewSupplierGstType] = useState<'Intra-State' | 'Inter-State'>('Intra-State');
            const [newSupplierCreditVoucherApplicable, setNewSupplierCreditVoucherApplicable] = useState(false);
					  const [newSupplierAddress, setNewSupplierAddress] = useState('');
					  const [newSupplierPhone, setNewSupplierPhone] = useState('');
            const [newSupplierMobile2, setNewSupplierMobile2] = useState('');
            const [newSupplierContactPerson, setNewSupplierContactPerson] = useState('');
            const [newSupplierContactPersonMobile, setNewSupplierContactPersonMobile] = useState('');
            const [newSupplierCity, setNewSupplierCity] = useState('');
            const [newSupplierState, setNewSupplierState] = useState('');
					  const [newSupplierPaymentTerms, setNewSupplierPaymentTerms] = useState('');
					  const [newSupplierIsVendor, setNewSupplierIsVendor] = useState(false);
            const [newSupplierCatalogueLink, setNewSupplierCatalogueLink] = useState('');
					  const [newCustomerName, setNewCustomerName] = useState('');
					  const [newCustomerMobile, setNewCustomerMobile] = useState('');
					  const [newCustomerAddress, setNewCustomerAddress] = useState('');
	          const [newCustomerCategoryName, setNewCustomerCategoryName] = useState('');
	          const [newCustomerSubCategoryName, setNewCustomerSubCategoryName] = useState('');
	          const [newCustomerCity, setNewCustomerCity] = useState('');
	          const [newCustomerState, setNewCustomerState] = useState('');
	          const [newCustomerContactPerson, setNewCustomerContactPerson] = useState('');
	          const [newCustomerContactNumber, setNewCustomerContactNumber] = useState('');
	          const [newCustomerEmailId, setNewCustomerEmailId] = useState('');
					  const [newTransporterName, setNewTransporterName] = useState('');
					  const [newTransporterPhone, setNewTransporterPhone] = useState('');
					  const [newUnitName, setNewUnitName] = useState('');
            const [newPriorityName, setNewPriorityName] = useState('');
					  const [newItemCategoryName, setNewItemCategoryName] = useState('');
						  const [newItemName, setNewItemName] = useState('');
              const [newItemNameType, setNewItemNameType] = useState<'Goods' | 'Services'>('Goods');
						  const [newItemNameUnitId, setNewItemNameUnitId] = useState('');
						  const [newItemNameCategoryId, setNewItemNameCategoryId] = useState('');
						  const [newItemNameSpecIds, setNewItemNameSpecIds] = useState<string[]>([]);
	            const [newItemNameCatalogueLink, setNewItemNameCatalogueLink] = useState('');
			  const [newSpecName, setNewSpecName] = useState('');
		  const [specIdForValues, setSpecIdForValues] = useState('');
		  const [specValuesFilterItemNameId, setSpecValuesFilterItemNameId] = useState('');
	  const [newSpecValue, setNewSpecValue] = useState('');
	  const [newSpecValueSpecId, setNewSpecValueSpecId] = useState('');

  const [newItemItemNameId, setNewItemItemNameId] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemPhotos, setNewItemPhotos] = useState<string[]>(['', '', '', '', '']);
  const [newItemLink, setNewItemLink] = useState('');
  const [newItemVideoLink, setNewItemVideoLink] = useState('');
  const [newItemReorderLevel, setNewItemReorderLevel] = useState('');
  const [newItemOpeningStock, setNewItemOpeningStock] = useState('');
  const [newItemStoreOpeningBalances, setNewItemStoreOpeningBalances] = useState<Array<{ storeId: string; storeName: string; quantity: string }>>([]);
  const [newItemSpecs, setNewItemSpecs] = useState<Array<{ specificationId: string; value: string; useCustom?: boolean }>>([
    { specificationId: '', value: '', useCustom: false },
  ]);
  const [inlineCreatedItemNameIds, setInlineCreatedItemNameIds] = useState<string[]>([]);
  const [specValueOptions, setSpecValueOptions] = useState<Record<string, SpecificationValue[]>>({});

  const [inlineItemNameOpen, setInlineItemNameOpen] = useState(false);
  const [inlineItemNameName, setInlineItemNameName] = useState('');
  const [inlineItemNameUnitId, setInlineItemNameUnitId] = useState('');
  const [inlineItemNameCategoryId, setInlineItemNameCategoryId] = useState('');
  const [inlineItemNameError, setInlineItemNameError] = useState<string | null>(null);

  const [inlineUnitCreateOpen, setInlineUnitCreateOpen] = useState(false);
  const [inlineUnitCreateName, setInlineUnitCreateName] = useState('');
  const [inlineUnitCreateBusy, setInlineUnitCreateBusy] = useState(false);
  const [inlineUnitCreateError, setInlineUnitCreateError] = useState<string | null>(null);

	  const [inlineCategoryCreateOpen, setInlineCategoryCreateOpen] = useState(false);
	  const [inlineCategoryCreateName, setInlineCategoryCreateName] = useState('');
		  const [inlineCategoryCreateBusy, setInlineCategoryCreateBusy] = useState(false);
		  const [inlineCategoryCreateError, setInlineCategoryCreateError] = useState<string | null>(null);

		  const [listQuery, setListQuery] = useState('');
		  const [listFields, setListFields] = useState<string[]>(['name']);
      const listField = 'all';
		  const [listStatusFilter, setListStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
	      const [cityStateFilters, setCityStateFilters] = useState<string[]>([]);
	      const [cityNameFilters, setCityNameFilters] = useState<string[]>([]);
      const [customerNameFilter, setCustomerNameFilter] = useState('');

		  useEffect(() => {
		    setListQuery('');
		    // Default filter field per tab (user asked for "like name")
			    setListFields([
			      tab === 'firms' ||
		        tab === 'departments' ||
		        tab === 'stores' ||
		        tab === 'projects' ||
		        tab === 'users' ||
		        tab === 'suppliers' ||
		        tab === 'customers' ||
		        tab === 'transporters' ||
		        tab === 'units' ||
		        tab === 'priorities' ||
		        tab === 'itemCategories' ||
		        tab === 'itemNames' ||
		        tab === 'specs' ||
		        tab === 'specValues' ||
		        tab === 'items'
			        ? 'name'
			        : 'name'
			    ]);
		    setListStatusFilter('all');
		  }, [tab]);

	  const activeTabLabel = useMemo(() => {
	    return MASTERS_TABS.find((t) => t.key === tab)?.label ?? 'Masters';
	  }, [tab]);

	  const specNameLookup = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s.name])), [specs]);
	  const specIdByName = useMemo(() => Object.fromEntries(specs.map((s) => [s.name, s.id])), [specs]);
	  const selectedSpec = useMemo(() => specs.find((s) => s.id === specIdForValues) ?? null, [specIdForValues, specs]);

		  const listQueryKey = useMemo(() => normalizeKey(listQuery), [listQuery]);
		  const firmNameLookup = useMemo(() => Object.fromEntries(firms.map((f) => [f.id, f.name])), [firms]);

	  const listFieldOptions = useMemo((): Array<{ value: string; label: string }> => {
	    if (tab === 'firms')
	      return [
		        { value: 'name', label: 'Name' },
		        { value: 'gst', label: 'GST' },
		        { value: 'cin', label: 'CIN' },
		        { value: 'phone', label: 'Phone' },
		        { value: 'address', label: 'Address' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'suppliers')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'gst', label: 'GST' },
		        { value: 'city', label: 'City' },
		        { value: 'state', label: 'State' },
		        { value: 'phone', label: 'Mobile' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'customers')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'categoryName', label: 'Category Name' },
		        { value: 'subCategoryName', label: 'Sub-Category Name' },
		        { value: 'city', label: 'City' },
		        { value: 'state', label: 'State' },
		        { value: 'contactPerson', label: 'Contact Person' },
		        { value: 'contactNumber', label: 'Contact Number' },
		        { value: 'emailId', label: 'Email ID' },
		        { value: 'phone', label: 'Mobile' },
		        { value: 'address', label: 'Address' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'transporters')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'phone', label: 'Phone' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'stores')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'firm', label: 'Firm' },
		        { value: 'location', label: 'Location' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'projects')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'firm', label: 'Firm' },
		        { value: 'client', label: 'Customer' },
		        { value: 'status', label: 'Status' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'users')
		      return [
		        { value: 'name', label: 'Name' },
		        { value: 'loginId', label: 'Login ID' },
		        { value: 'role', label: 'Role' },
		        { value: 'email', label: 'Email' },
		        { value: 'mobile', label: 'Mobile' },
		        { value: 'all', label: 'All' },
		      ];
	    if (tab === 'departments' || tab === 'units' || tab === 'priorities' || tab === 'itemCategories' || tab === 'specs')
	      return [
	        { value: 'name', label: 'Name' },
	        { value: 'all', label: 'All' },
	      ];
	    if (tab === 'states')
	      return [
	        { value: 'name', label: 'Name' },
	        { value: 'all', label: 'All' },
	      ];
	    if (tab === 'cities')
	      return [
	        { value: 'name', label: 'City' },
	        { value: 'state', label: 'State' },
	        { value: 'all', label: 'All' },
	      ];
	    if (tab === 'itemNames')
	      return [
	        { value: 'name', label: 'Name' },
		        { value: 'unit', label: 'Unit' },
		        { value: 'category', label: 'Category' },
		        { value: 'spec', label: 'Specification' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'specValues')
		      return [
		        { value: 'name', label: 'Value' },
		        { value: 'spec', label: 'Specification' },
		        { value: 'itemName', label: 'Item Name' },
		        { value: 'all', label: 'All' },
		      ];
		    if (tab === 'items')
		      return [
		        { value: 'name', label: 'Item Name' },
		        { value: 'desc', label: 'Description' },
		        { value: 'link', label: 'Item Link' },
		        { value: 'video', label: 'Video Link' },
		        { value: 'all', label: 'All' },
		      ];
		    return [
		      { value: 'name', label: 'Name' },
		      { value: 'all', label: 'All' },
		    ];
		  }, [tab]);

		  const matchesListQuery = (values: Array<unknown>) => {
		    if (!listQueryKey) return true;
		    return values.some((v) => normalizeKey(v).includes(listQueryKey));
		  };

		  const filteredFirms = useMemo(() => {
		    if (!listQueryKey) return firms;
		    return firms.filter((f) => {
		      if (listField === 'all') return matchesListQuery([f.name, f.sortName, f.cin, f.gstNumber, f.address, f.phone, f.termsConditions]);
		      if (listField === 'gst') return matchesListQuery([f.gstNumber]);
		      if (listField === 'cin') return matchesListQuery([f.cin]);
		      if (listField === 'phone') return matchesListQuery([f.phone]);
		      if (listField === 'address') return matchesListQuery([f.address]);
		      return matchesListQuery([f.name]);
		    });
		  }, [firms, listQueryKey, listField]);

		  const filteredDepartments = useMemo(() => {
		    if (!listQueryKey) return departments;
		    return departments.filter((d) => matchesListQuery([d.name]));
		  }, [departments, listQueryKey]);

		  const filteredStates = useMemo(() => {
		    if (!listQueryKey) return states;
		    return states.filter((s) => matchesListQuery([s.name]));
		  }, [states, listQueryKey]);

				  const filteredCities = useMemo(() => {
          const rows = cities;
				    if (!listQueryKey) return rows;
				    return rows.filter((c) => {
				      if (listField === 'all') return matchesListQuery([c.state, c.name]);
				      if (listField === 'state') return matchesListQuery([c.state]);
				      return matchesListQuery([c.name]);
				    });
				  }, [cities, listQueryKey, listField]);

          const groupedCities = useMemo(() => {
            const byState = new Map<string, City[]>();
            for (const city of filteredCities) {
              const stateName = String(city.state ?? '').trim() || 'Unknown State';
              const list = byState.get(stateName) ?? [];
              list.push(city);
              byState.set(stateName, list);
            }
            return Array.from(byState.entries())
              .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
              .map(([state, entries]) => ({
                state,
                cities: entries
                  .slice()
                  .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' })),
              }));
          }, [filteredCities]);

		  const filteredStores = useMemo(() => {
		    if (!listQueryKey) return stores;
		    return stores.filter((s) => {
		      if (listField === 'all') return matchesListQuery([firmNameLookup[s.firmId], s.name, s.location]);
		      if (listField === 'firm') return matchesListQuery([firmNameLookup[s.firmId]]);
		      if (listField === 'location') return matchesListQuery([s.location]);
		      return matchesListQuery([s.name]);
		    });
		  }, [stores, listQueryKey, firmNameLookup, listField]);

		  const filteredProjects = useMemo(() => {
		    if (!listQueryKey) return projects;
		    return projects.filter((p) => {
		      if (listField === 'all') return matchesListQuery([firmNameLookup[p.firmId], p.name, p.clientName, p.status, p.startDate, p.endDate]);
		      if (listField === 'firm') return matchesListQuery([firmNameLookup[p.firmId]]);
		      if (listField === 'client') return matchesListQuery([p.clientName]);
		      if (listField === 'status') return matchesListQuery([p.status]);
		      return matchesListQuery([p.name]);
		    });
		  }, [projects, listQueryKey, firmNameLookup, listField]);

		  const filteredUsers = useMemo(() => {
		    const rows = users;
		    if (!listQueryKey) return rows;
		    return rows.filter((u) => {
		      if (listField === 'all') return matchesListQuery([u.name, (u as any).loginId, (u as any).role, u.designation, u.email, u.mobile]);
		      if (listField === 'loginId') return matchesListQuery([(u as any).loginId]);
		      if (listField === 'role') return matchesListQuery([(u as any).role, u.designation]);
		      if (listField === 'email') return matchesListQuery([u.email]);
		      if (listField === 'mobile') return matchesListQuery([u.mobile]);
		      return matchesListQuery([u.name]);
		    });
		  }, [users, listQueryKey, listField]);

		  const filteredSuppliers = useMemo(() => {
		    if (!listQueryKey) return suppliers;
		    return suppliers.filter((s) => {
		      if (listField === 'all')
		        return matchesListQuery([
		          s.name,
		          s.gstNumber,
		          s.gstType,
		          s.address,
		          s.phone,
		          s.contactPerson,
		          s.contactPersonMobile,
		          s.city,
		          s.state,
		          (s as any).mobile2,
		          (s as any).paymentTerms,
		          (s as any).catalogueLink,
		        ]);
		      if (listField === 'gst') return matchesListQuery([s.gstNumber]);
		      if (listField === 'city') return matchesListQuery([s.city]);
		      if (listField === 'state') return matchesListQuery([s.state]);
		      if (listField === 'phone') return matchesListQuery([s.phone, (s as any).mobile2]);
		      return matchesListQuery([s.name]);
		    });
		  }, [suppliers, listQueryKey, listField]);

			  const filteredCustomers = useMemo(() => {
          const rows = customers;
			    if (!listQueryKey) return rows;
			    return rows.filter((c) => {
			      if (listField === 'all') return matchesListQuery([c.name, c.phone, c.address, (c as any).categoryName, (c as any).subCategoryName, (c as any).city, (c as any).state, (c as any).contactPerson, (c as any).contactNumber, (c as any).emailId]);
			      if (listField === 'categoryName') return matchesListQuery([(c as any).categoryName]);
			      if (listField === 'subCategoryName') return matchesListQuery([(c as any).subCategoryName]);
			      if (listField === 'city') return matchesListQuery([(c as any).city]);
			      if (listField === 'state') return matchesListQuery([(c as any).state]);
			      if (listField === 'contactPerson') return matchesListQuery([(c as any).contactPerson]);
			      if (listField === 'contactNumber') return matchesListQuery([(c as any).contactNumber]);
			      if (listField === 'emailId') return matchesListQuery([(c as any).emailId]);
			      if (listField === 'phone') return matchesListQuery([c.phone]);
			      if (listField === 'address') return matchesListQuery([c.address]);
			      return matchesListQuery([c.name]);
			    });
			  }, [customers, listQueryKey, listField]);

		  const filteredTransporters = useMemo(() => {
		    if (!listQueryKey) return transporters;
		    return transporters.filter((t) => {
		      if (listField === 'all') return matchesListQuery([t.name, t.phone]);
		      if (listField === 'phone') return matchesListQuery([t.phone]);
		      return matchesListQuery([t.name]);
		    });
		  }, [transporters, listQueryKey, listField]);

	  const filteredUnits = useMemo(() => {
	    if (!listQueryKey) return units;
	    return units.filter((u) => matchesListQuery([u.name]));
	  }, [units, listQueryKey]);

	  const filteredPriorities = useMemo(() => {
	    if (!listQueryKey) return priorities;
	    return priorities.filter((p) => matchesListQuery([p.name]));
	  }, [priorities, listQueryKey]);

	  const filteredItemCategories = useMemo(() => {
	    if (!listQueryKey) return itemCategories;
	    return itemCategories.filter((c) => matchesListQuery([c.name]));
	  }, [itemCategories, listQueryKey]);

		  const filteredItemNames = useMemo(() => {
		    if (!listQueryKey) return itemNames;
		    return itemNames.filter((n) => {
		      if (listField === 'all')
		        return matchesListQuery([
		          n.name,
		          n.unitName,
		          n.itemCategoryName,
		          (n as any).catalogueLink,
		          ...(Array.isArray(n.specificationIds) ? n.specificationIds.map((id) => specNameLookup[id]) : []),
		        ]);
		      if (listField === 'unit') return matchesListQuery([n.unitName]);
		      if (listField === 'category') return matchesListQuery([n.itemCategoryName]);
		      if (listField === 'spec')
		        return matchesListQuery([...(Array.isArray(n.specificationIds) ? n.specificationIds.map((id) => specNameLookup[id]) : [])]);
		      return matchesListQuery([n.name]);
		    });
		  }, [itemNames, listQueryKey, specNameLookup, listField]);

	  const filteredSpecs = useMemo(() => {
	    if (!listQueryKey) return specs;
	    return specs.filter((s) => matchesListQuery([s.name]));
	  }, [specs, listQueryKey]);

		  const filteredSpecValues = useMemo(() => {
		    const rows = specValues;
		    if (!listQueryKey) return rows;
		    return rows.filter((v) => {
		      if (listField === 'all') return matchesListQuery([specNameLookup[v.specificationId], v.itemName, v.value]);
		      if (listField === 'spec') return matchesListQuery([specNameLookup[v.specificationId], v.specificationId]);
		      if (listField === 'itemName') return matchesListQuery([v.itemName]);
		      return matchesListQuery([v.value]);
		    });
		  }, [specValues, listQueryKey, specNameLookup, listField]);

		  const filteredItems = useMemo(() => {
        const goodsItemNameIds = new Set(
          itemNames.filter((n) => (n.type ?? 'Goods') === 'Goods').map((n) => String(n.id))
        );
        const goodsOnly = items.filter((it) => goodsItemNameIds.has(String(it.itemNameId ?? '')));
		    if (!listQueryKey) return goodsOnly;
		    return goodsOnly.filter((it) => {
		      const full = formatItemInline(it.itemName, it.specificationsJson, specNameLookup);
		      if (listField === 'all')
		        return matchesListQuery([
		          it.itemName,
		          it.itemCode,
		          it.uniqueKey,
		          it.description,
		          it.unit,
		          (it as any).itemLink,
		          (it as any).videoLink,
		          full,
		        ]);
		      if (listField === 'desc') return matchesListQuery([it.description]);
		      if (listField === 'link') return matchesListQuery([(it as any).itemLink]);
		      if (listField === 'video') return matchesListQuery([(it as any).videoLink]);
		      return matchesListQuery([it.itemName, full]);
		    });
		  }, [items, itemNames, listQueryKey, specNameLookup, listField]);

	  const searchPlaceholder = useMemo(() => {
	    if (tab === 'firms') return 'Search firms...';
	    if (tab === 'stores') return 'Search stores...';
	    if (tab === 'departments') return 'Search departments...';
	    if (tab === 'states') return 'Search states...';
	    if (tab === 'cities') return 'Search cities...';
	    if (tab === 'users') return 'Search users...';
	    if (tab === 'suppliers') return 'Search suppliers...';
	    if (tab === 'customers') return 'Search customers...';
	    if (tab === 'transporters') return 'Search transporters...';
	    if (tab === 'projects') return 'Search projects...';
	    if (tab === 'units') return 'Search units...';
	    if (tab === 'priorities') return 'Search priorities...';
	    if (tab === 'itemCategories') return 'Search item categories...';
	    if (tab === 'itemNames') return 'Search item names...';
	    if (tab === 'specs') return 'Search specifications...';
	    if (tab === 'specValues') return 'Search spec values...';
	    if (tab === 'items') return 'Search items...';
	    return 'Search...';
	  }, [tab]);

	  const closeInlineUnitCreate = () => {
	    setInlineUnitCreateOpen(false);
	    setInlineUnitCreateName('');
	    setInlineUnitCreateError(null);
  };

  const submitInlineUnitCreate = () => {
    const name = inlineUnitCreateName.trim();
    if (!name) {
      setInlineUnitCreateError('Please enter Unit.');
      return;
    }
    if (inlineUnitCreateBusy) return;
    setInlineUnitCreateBusy(true);
    setInlineUnitCreateError(null);
    createUnit({ name, createdBy: 'system' })
      .then((created) => {
        const unit = created.unit;
        if (!unit?.id) return;
        setUnits((prev) => {
          if (prev.some((p) => p.id === unit.id)) return prev;
          return [...prev, unit].sort((a, b) => a.name.localeCompare(b.name));
        });
        setInlineItemNameUnitId(unit.id);
        closeInlineUnitCreate();
      })
      .catch((e) => setInlineUnitCreateError(e instanceof Error ? e.message : String(e)))
      .finally(() => setInlineUnitCreateBusy(false));
  };

  const closeInlineCategoryCreate = () => {
    setInlineCategoryCreateOpen(false);
    setInlineCategoryCreateName('');
    setInlineCategoryCreateError(null);
  };

  const submitInlineCategoryCreate = () => {
    const name = inlineCategoryCreateName.trim();
    if (!name) {
      setInlineCategoryCreateError('Please enter Item Category.');
      return;
    }
    if (inlineCategoryCreateBusy) return;
    setInlineCategoryCreateBusy(true);
    setInlineCategoryCreateError(null);
    createItemCategory({ name, createdBy: 'system' })
      .then((created) => {
        const cat = created.itemCategory;
        if (!cat?.id) return;
        setItemCategories((prev) => {
          if (prev.some((p) => p.id === cat.id)) return prev;
          return [...prev, cat].sort((a, b) => a.name.localeCompare(b.name));
        });
        setInlineItemNameCategoryId(cat.id);
        closeInlineCategoryCreate();
      })
      .catch((e) => setInlineCategoryCreateError(e instanceof Error ? e.message : String(e)))
      .finally(() => setInlineCategoryCreateBusy(false));
  };

  const selectedItemUnitName = useMemo(() => {
    const row = itemNames.find((n) => n.id === newItemItemNameId);
    if (!row) return '';
    if (row.unitName) return row.unitName;
    if (row.unitId) return units.find((u) => u.id === row.unitId)?.name ?? '';
    return '';
  }, [itemNames, newItemItemNameId, units]);

  useEffect(() => {
    setNewItemUnit(selectedItemUnitName);
  }, [selectedItemUnitName]);

  const buildDefaultStoreOpeningRows = () =>
    stores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      quantity: '',
    }));

  useEffect(() => {
    if (!addOpen || tab !== 'items') return;
    if (newItemStoreOpeningBalances.length) return;
    setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
  }, [addOpen, tab, stores, newItemStoreOpeningBalances.length]);
	  const groupedSpecValues = useMemo(() => {
	    const map = new Map<
	      string,
	      { specId: string; specName: string; values: Array<{ id: string; value: string; isUsed: boolean; usageCount: number }> }
	    >();
    for (const row of specValues) {
      const specId = row.specificationId;
      const specName = specNameLookup[specId] ?? specId;
      const entry = map.get(specId) ?? { specId, specName, values: [] };
      entry.values.push({ id: row.id, value: row.value, isUsed: Boolean(row.isUsed), usageCount: Number(row.usageCount ?? 0) });
      map.set(specId, entry);
    }
    const list = Array.from(map.values());
    list.forEach((r) => r.values.sort((a, b) => a.value.localeCompare(b.value)));
	    list.sort((a, b) => a.specName.localeCompare(b.specName));
	    return list;
	  }, [specNameLookup, specValues]);

	  const sidebarPermissionItems = useMemo(() => getSidebarPermissionItems(), []);
	  const sidebarPermissionKeys = useMemo(() => sidebarPermissionItems.map((x) => x.key), [sidebarPermissionItems]);

	  const menuAccessCategories = useMemo(() => {
	    type Cat = { id: string; title: string; items: Array<{ key: string; label: string }> };
	    const buckets: Record<string, Cat> = {
	      main: { id: 'main', title: 'Main Menu', items: [] },
	      masters: { id: 'masters', title: 'Masters', items: [] },
	      pending: { id: 'pending', title: 'Pending Tasks', items: [] },
	      stock: { id: 'stock', title: 'Stock', items: [] },
	      purchase: { id: 'purchase', title: 'Purchase Masters', items: [] },
	      other: { id: 'other', title: 'Other', items: [] },
	    };

	    for (const it of sidebarPermissionItems) {
	      const k = String(it.key ?? '');
	      if (k.startsWith('masters:')) buckets.masters.items.push(it);
	      else if (k.startsWith('pending:')) buckets.pending.items.push(it);
	      else if (k.startsWith('stock:')) buckets.stock.items.push(it);
	      else if (k.startsWith('purchase:')) buckets.purchase.items.push(it);
	      else if (!k.includes(':')) buckets.main.items.push(it);
	      else buckets.other.items.push(it);
	    }

	    const cats = Object.values(buckets)
	      .filter((c) => c.items.length)
	      .map((c) => ({
	        ...c,
	        items: c.items.slice().sort((a, b) => a.label.localeCompare(b.label)),
	      }));

	    // Stable ordering.
	    const order = ['main', 'masters', 'pending', 'stock', 'purchase', 'other'];
	    cats.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
	    return cats;
	  }, [sidebarPermissionItems]);

	  const userRoleOptions = useMemo(() => {
	    const set = new Set<string>();
	    for (const u of users) {
	      const r = String((u as any).role ?? u.designation ?? '').trim();
	      if (r) set.add(r);
	    }
	    for (const r of extraUserRoles) {
	      const t = String(r ?? '').trim();
	      if (t) set.add(t);
	    }
	    const cur = newUserRole.trim();
	    if (cur) set.add(cur);
	    return Array.from(set).sort((a, b) => a.localeCompare(b));
	  }, [users, extraUserRoles, newUserRole]);

  useEffect(() => {
    if (!externalTab) return;
    setTab(externalTab);
  }, [externalTab]);

  useEffect(() => {
    setAddOpen(false);
    setEditCtx(null);
    setFieldErrors({});
    setError(null);
  }, [tab]);

  const closeModal = () => {
    setAddOpen(false);
    setEditCtx(null);
    setFieldErrors({});
    setError(null);
  };

						  const openAddModal = () => {
						    setEditCtx(null);
						    setError(null);
						    setFieldErrors({});
						    if (tab === 'firms') {
						      setNewFirmName('');
						      setNewFirmSortName('');
					      setNewFirmCin('');
					      setNewFirmGstNumber('');
					      setNewFirmAddress('');
					      setNewFirmPhone('');
					      setNewFirmLogoUrl('');
					      setNewFirmTermsConditions('');
							    }
							    if (tab === 'departments') setNewDepartmentName('');
							    if (tab === 'states') setNewStateName('');
							    if (tab === 'cities') {
							      setNewCityState('');
							      setNewCityName('');
							    }
							    if (tab === 'stores') {
							      setNewStoreFirmId('');
							      setNewStoreName('');
							      setNewStoreLocation('');
							    }
					    if (tab === 'projects') {
					      setNewProjectFirmId('');
					      setNewProjectName('');
					      setNewProjectClientName('');
					      setNewProjectStartDate('');
				      setNewProjectEndDate('');
				      setNewProjectStatus('');
				    }
				    if (tab === 'users') {
				      setNewUserName('');
			      setNewUserEmail('');
			      setNewUserLoginId('');
			      setNewUserRole('');
			      setNewUserMenuAccess([]);
			      setNewUserIsActive(true);
			      setNewUserPassword('');
			      setNewUserMobile('');
            setNewUserPoApprovalAmount('');
			    }
						    if (tab === 'suppliers') {
						      setNewSupplierName('');
						      setNewSupplierGstNumber('');
						      setNewSupplierGstType('Intra-State');
                  setNewSupplierCreditVoucherApplicable(false);
						      setNewSupplierAddress('');
						      setNewSupplierPhone('');
						      setNewSupplierPaymentTerms('');
						      setNewSupplierIsVendor(false);
	                  setNewSupplierCatalogueLink('');
						    }
						    if (tab === 'customers') {
						      setNewCustomerName('');
						      setNewCustomerMobile('');
						      setNewCustomerAddress('');
	                setNewCustomerCategoryName('');
	                setNewCustomerSubCategoryName('');
	                setNewCustomerCity('');
	                setNewCustomerState('');
	                setNewCustomerContactPerson('');
	                setNewCustomerContactNumber('');
	                setNewCustomerEmailId('');
						    }
					    if (tab === 'transporters') {
					      setNewTransporterName('');
					      setNewTransporterPhone('');
					    }
				    if (tab === 'units') setNewUnitName('');
            if (tab === 'priorities') setNewPriorityName('');
				    if (tab === 'itemCategories') setNewItemCategoryName('');
						    if (tab === 'itemNames') {
						      setNewItemName('');
                  setNewItemNameType('Goods');
						      setNewItemNameUnitId('');
						      setNewItemNameCategoryId('');
						      setNewItemNameSpecIds([]);
	                setNewItemNameCatalogueLink('');
						    }
				    if (tab === 'specs') setNewSpecName('');
				    if (tab === 'specValues') {
				      setNewSpecValue('');
			      setNewSpecValueSpecId(specIdForValues || '');
			      setSpecValueItemNameId('');
			    }
	    if (tab === 'items') {
	      setNewItemUnit('');
	      setNewItemDescription('');
	      setNewItemPhotos(['', '', '', '', '']);
	      setNewItemLink('');
	      setNewItemVideoLink('');
	      setNewItemReorderLevel('');
	      setNewItemOpeningStock('');
        setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
	      setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
	    }
	    setAddOpen(true);
	  };

						  const openEditModal = (id: string) => {
						    setError(null);
						    setFieldErrors({});
						    setEditCtx({ tab, id });
						    if (tab === 'firms') {
					      const row = firms.find((f) => f.id === id);
					      setNewFirmName(row?.name ?? '');
					      setNewFirmSortName(row?.sortName ?? '');
					      setNewFirmCin(row?.cin ?? '');
					      setNewFirmGstNumber(row?.gstNumber ?? '');
					      setNewFirmAddress(row?.address ?? '');
					      setNewFirmPhone(row?.phone ?? '');
					      setNewFirmLogoUrl(row?.logoUrl ?? '');
					      setNewFirmTermsConditions(row?.termsConditions ?? '');
					    }
				    if (tab === 'departments') {
				      const row = departments.find((d) => d.id === id);
				      setNewDepartmentName(row?.name ?? '');
				    }
				    if (tab === 'states') {
				      const row = states.find((s) => s.id === id);
				      setNewStateName(row?.name ?? '');
				    }
				    if (tab === 'cities') {
				      const row = cities.find((c) => c.id === id);
				      setNewCityState((row as any)?.state ?? '');
				      setNewCityName((row as any)?.name ?? '');
				    }
						    if (tab === 'stores') {
						      const row = stores.find((s) => s.id === id);
						      if (row) {
				        setNewStoreFirmId(row.firmId);
				        setNewStoreName(row.name);
				        setNewStoreLocation(String(row.location ?? ''));
				      }
				    }
				    if (tab === 'projects') {
				      const row = projects.find((p) => p.id === id);
				      if (row) {
			        setNewProjectFirmId(row.firmId);
			        setNewProjectName(row.name ?? '');
			        setNewProjectClientName(row.clientName ?? '');
			        setNewProjectStartDate(row.startDate ?? '');
			        setNewProjectEndDate(row.endDate ?? '');
			        setNewProjectStatus(row.status ?? '');
			      }
			    }
				    if (tab === 'users') {
				      const row = users.find((u) => u.id === id);
				      if (row) {
				        setNewUserName(row.name ?? '');
			        setNewUserEmail(row.email ?? '');
			        setNewUserLoginId(String((row as any).loginId ?? ''));
			        setNewUserRole(String((row as any).role ?? row.designation ?? ''));
			        setNewUserMenuAccess(Array.isArray((row as any).menuAccess) ? ((row as any).menuAccess as any[]).map((x) => String(x)) : []);
			        setNewUserIsActive((row as any).isActive === false ? false : true);
			        setNewUserPassword('');
			        setNewUserMobile(row.mobile ?? '');
              setNewUserPoApprovalAmount((row as any).poApprovalAmount == null ? '' : String((row as any).poApprovalAmount));
			      }
			    }
					    if (tab === 'suppliers') {
					      const row = suppliers.find((s) => s.id === id);
					      setNewSupplierName(row?.name ?? '');
					      setNewSupplierGstNumber(row?.gstNumber ?? '');
					      setNewSupplierGstType((row?.gstType ?? 'Intra-State') === 'Inter-State' ? 'Inter-State' : 'Intra-State');
                setNewSupplierCreditVoucherApplicable(Boolean((row as any)?.creditVoucherApplicable));
					      setNewSupplierAddress(row?.address ?? '');
					      setNewSupplierPhone(row?.phone ?? '');
              setNewSupplierMobile2((row as any)?.mobile2 ?? '');
              setNewSupplierContactPerson((row as any)?.contactPerson ?? '');
              setNewSupplierContactPersonMobile((row as any)?.contactPersonMobile ?? '');
              setNewSupplierCity((row as any)?.city ?? '');
              setNewSupplierState((row as any)?.state ?? '');
				      setNewSupplierPaymentTerms(row?.paymentTerms ?? '');
				      setNewSupplierIsVendor(Boolean(row?.isVendor));
              setNewSupplierCatalogueLink((row as any)?.catalogueLink ?? '');
				    }
				    if (tab === 'customers') {
				      const row = customers.find((c) => c.id === id);
				      setNewCustomerName(row?.name ?? '');
				      setNewCustomerMobile(row?.phone ?? '');
				      setNewCustomerAddress(row?.address ?? '');
	            setNewCustomerCategoryName((row as any)?.categoryName ?? '');
	            setNewCustomerSubCategoryName((row as any)?.subCategoryName ?? '');
	            setNewCustomerCity((row as any)?.city ?? '');
	            setNewCustomerState((row as any)?.state ?? '');
	            setNewCustomerContactPerson((row as any)?.contactPerson ?? '');
	            setNewCustomerContactNumber((row as any)?.contactNumber ?? '');
	            setNewCustomerEmailId((row as any)?.emailId ?? '');
				    }
					    if (tab === 'transporters') {
					      const row = transporters.find((t) => t.id === id);
					      setNewTransporterName(row?.name ?? '');
					      setNewTransporterPhone(row?.phone ?? '');
					    }
			    if (tab === 'units') {
			      const row = units.find((u) => u.id === id);
			      setNewUnitName(row?.name ?? '');
			    }
            if (tab === 'priorities') {
              const row = priorities.find((p) => p.id === id);
              setNewPriorityName(row?.name ?? '');
            }
			    if (tab === 'itemCategories') {
			      const row = itemCategories.find((c) => c.id === id);
			      setNewItemCategoryName(row?.name ?? '');
			    }
					    if (tab === 'itemNames') {
					      const row = itemNames.find((n) => n.id === id);
				      setNewItemName(row?.name ?? '');
                setNewItemNameType(((row as any)?.type ?? 'Goods') === 'Services' ? 'Services' : 'Goods');
					      setNewItemNameUnitId(row?.unitId ?? '');
					      setNewItemNameCategoryId(row?.itemCategoryId ?? '');
					      setNewItemNameSpecIds(Array.isArray((row as any)?.specificationIds) ? ((row as any).specificationIds as any[]).map((x) => String(x)) : []);
	              setNewItemNameCatalogueLink((row as any)?.catalogueLink ?? '');
				    }
	    if (tab === 'specs') {
	      const row = specs.find((s) => s.id === id);
	      setNewSpecName(row?.name ?? '');
	    }
		    if (tab === 'specValues') {
		      const row = specValues.find((v) => v.id === id);
		      if (row) {
		        setNewSpecValueSpecId(row.specificationId);
		        setSpecValueItemNameId(String((row as any).itemNameId ?? ''));
		        setNewSpecValue(row.value);
		      }
		    }
	    if (tab === 'items') {
	      const row = items.find((it) => it.id === id);
		      if (row) {
		        setNewItemItemNameId(row.itemNameId);
            setNewItemUnit(row.unit ?? '');
		        setNewItemDescription(row.description ?? '');
            setNewItemPhotos([
              String((row as any).photo1 ?? ''),
              String((row as any).photo2 ?? ''),
              String((row as any).photo3 ?? ''),
              String((row as any).photo4 ?? ''),
              String((row as any).photo5 ?? ''),
            ]);
            setNewItemLink(String((row as any).itemLink ?? ''));
            setNewItemVideoLink(String((row as any).videoLink ?? ''));
	            setNewItemReorderLevel(row.reorderLevel == null ? '' : String(row.reorderLevel));
	            setNewItemOpeningStock((row as any).openingStock == null ? '' : String((row as any).openingStock));
              setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
              fetch(`/api/masters/items/${encodeURIComponent(id)}/opening-balances`)
                .then(async (res) => {
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(String((data as any)?.error ?? `Failed to load opening balances (${res.status})`));
                  const balances = Array.isArray((data as any)?.balances) ? (data as any).balances : [];
                  const qtyByStore = new Map<string, number>();
                  for (const b of balances) {
                    const key = String(b?.storeId ?? '').trim();
                    if (!key) continue;
                    const prev = qtyByStore.get(key) ?? 0;
                    qtyByStore.set(key, prev + Number(b?.quantity ?? 0));
                  }
                  setNewItemStoreOpeningBalances(
                    stores.map((store) => ({
                      storeId: store.id,
                      storeName: store.name,
                      quantity: qtyByStore.has(store.id) ? String(qtyByStore.get(store.id) ?? 0) : '',
                    }))
                  );
                })
                .catch(() => {
                  setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
                });
		        try {
	          const obj = JSON.parse(row.specificationsJson) as Record<string, unknown>;
		          const next = Object.entries(obj)
		            .map(([k, v]) => ({
		              specificationId: specNameLookup[k] ? k : specIdByName[k] ?? '',
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
					      case 'departments':
					        return `${verb} Department`;
					      case 'states':
					        return `${verb} State`;
					      case 'cities':
					        return `${verb} City`;
					      case 'stores':
					        return `${verb} Store`;
				      case 'projects':
				        return `${verb} Project`;
					      case 'units':
					        return `${verb} Unit`;
              case 'priorities':
                return `${verb} Priority`;
					      case 'itemCategories':
				        return `${verb} Item Category`;
				      case 'users':
				        return `${verb} User`;
				      case 'suppliers':
				        return `${verb} Supplier`;
				      case 'customers':
				        return `${verb} Customer`;
				      case 'transporters':
				        return `${verb} Transporter`;
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
									      fetchDepartments(signal),
									      fetchFirms(signal),
									      fetchStates(signal),
									      fetchCities(signal),
									      fetchProjects(signal),
									      fetchStores(signal),
									      fetchUsers({ signal, includeInactive: tab === 'users' }),
								      fetchSuppliers(signal),
								      fetchCustomers(signal),
							      fetchTransporters(signal),
								      fetchUnits(signal),
                      fetchPriorities(signal),
							      fetchItemCategories(signal),
						      fetchItemNames(signal),
						      fetchSpecifications(signal),
						      fetchItems(signal),
								    ]).then(([deps, f, stt, cty, prj, st, u, sup, cus, trn, unt, pri, cats, inames, sp, it]) => {
							      setDepartments(deps);
							      setFirms(f);
							      setStates(stt);
							      setCities(cty);
							      setProjects(prj);
							      setStores(st);
								      setUsers(u);
								      setSuppliers(sup);
							      setCustomers(cus);
							      setTransporters(trn);
								      setUnits(unt);
                      setPriorities(pri);
								      setItemCategories(cats);
							      setItemNames(inames);
						      setSpecs(sp);
						      setItems(it);
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
		        const rows = await fetchSpecificationValues(specIdForValues, { signal: ac.signal, itemNameId: specValuesFilterItemNameId || undefined });
		        setSpecValues(rows);
		        return;
		      }
		
		      const all = await Promise.all(
		        specs.map((s) => fetchSpecificationValues(s.id, { signal: ac.signal, itemNameId: specValuesFilterItemNameId || undefined }))
		      );
		      const flat = all
		        .flat()
	        .sort((a, b) => {
          const an = specNameLookup[a.specificationId] ?? '';
          const bn = specNameLookup[b.specificationId] ?? '';
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
		  }, [specIdForValues, specValuesFilterItemNameId, specs, specNameLookup]);
	
			  useEffect(() => {
			    if (!addOpen) return;
			    if (tab !== 'specValues') return;
			    setNewSpecValueSpecId((prev) => prev || specIdForValues || '');
			  }, [addOpen, specIdForValues, specs, tab]);

        const apiKeyForTab = (t: MastersTab) => {
          if (t === 'itemCategories') return 'item-categories';
          if (t === 'itemNames') return 'item-names';
          if (t === 'specs') return 'specifications';
          if (t === 'specValues') return 'specification-values';
          return t;
        };

	        async function refreshCurrentTab(t: MastersTab) {
	          if (t === 'firms') return fetchFirms().then(setFirms);
	          if (t === 'stores') return fetchStores().then(setStores);
	          if (t === 'departments') return fetchDepartments().then(setDepartments);
	          if (t === 'states') return fetchStates().then(setStates);
	          if (t === 'cities') return fetchCities().then(setCities);
		          if (t === 'users') return fetchUsers({ includeInactive: true }).then(setUsers);
	          if (t === 'suppliers') return fetchSuppliers().then(setSuppliers);
	          if (t === 'customers') return fetchCustomers().then(setCustomers);
	          if (t === 'transporters') return fetchTransporters().then(setTransporters);
	          if (t === 'projects') return fetchProjects().then(setProjects);
	          if (t === 'units') return fetchUnits().then(setUnits);
            if (t === 'priorities') return fetchPriorities().then(setPriorities);
	          if (t === 'itemCategories') return fetchItemCategories().then(setItemCategories);
          if (t === 'itemNames') return fetchItemNames().then(setItemNames);
          if (t === 'specs') return fetchSpecifications().then(setSpecs);
	          if (t === 'specValues') {
	            if (specIdForValues)
	              return fetchSpecificationValues(specIdForValues, { itemNameId: specValuesFilterItemNameId || undefined }).then(setSpecValues);
	            const all = await Promise.all(
	              specs.map((s) => fetchSpecificationValues(s.id, { itemNameId: specValuesFilterItemNameId || undefined }))
	            );
	            const flat = all
	              .flat()
              .sort((a, b) => {
                const an = specNameLookup[a.specificationId] ?? '';
                const bn = specNameLookup[b.specificationId] ?? '';
                if (an !== bn) return an.localeCompare(bn);
                return a.value.localeCompare(b.value);
              });
            setSpecValues(flat);
            return;
          }
          if (t === 'items') return fetchItems().then(setItems);
        }

	        async function importItemRows(rows: PendingItemUploadRow[]) {
          let created = 0;
          const failures: ItemUploadIssue[] = [];
          const itemNameIdByName = new Map(itemNames.map((n) => [normalizeKey(n.name), n.id]));
          const itemNameUnitByName = new Map(itemNames.map((n) => [normalizeKey(n.name), normalizeKey(n.unitName ?? '')]));
          const formatCombo = (itemName: string, specs: Array<{ specificationId: string; value: string }>) => {
            const specText = specs
              .slice()
              .sort((a, b) => a.specificationId.localeCompare(b.specificationId))
              .map((s) => `${specNameLookup[s.specificationId] ?? s.specificationId}: ${String(s.value ?? '').trim()}`)
              .filter((x) => x.endsWith(': ') === false)
              .join(' | ');
            return specText ? `${itemName} - ${specText}` : itemName;
          };
          const makeSignature = (itemNameId: string, specs: Array<{ specificationId: string; value: string }>) =>
            `${itemNameId}::${specs
              .slice()
              .sort((a, b) => a.specificationId.localeCompare(b.specificationId))
              .map((s) => `${s.specificationId}=${String(s.value ?? '').trim()}`)
              .join('|')}`;
          const existingSignatures = new Set(
            items
              .map((it) => {
                try {
                  const raw = JSON.parse(it.specificationsJson || '{}') as Record<string, unknown>;
                  const specs = Object.entries(raw).map(([specificationId, value]) => ({ specificationId, value: String(value ?? '') }));
                  return makeSignature(it.itemNameId, specs);
                } catch {
                  return '';
                }
              })
              .filter(Boolean)
          );
	          const inFileSignatures = new Set<string>();
	          const duplicateInFileRows: string[] = [];
	          const duplicateExistingRows: string[] = [];
	          const invalidReorderRows: string[] = [];
	          const invalidOpeningRows: string[] = [];
	          for (const row of rows) {
	            const itemNameId = itemNameIdByName.get(normalizeKey(row.itemName));
	            if (!itemNameId) continue;
	            const sig = makeSignature(itemNameId, row.specs);
	            const comboLabel = formatCombo(row.itemName, row.specs);
	            if (row.reorderLevel.trim()) {
	              const reorderLevelNumber = Number(row.reorderLevel);
	              if (!Number.isFinite(reorderLevelNumber) || reorderLevelNumber < 0) invalidReorderRows.push(comboLabel);
	            }
            const badOpening = row.storeOpeningBalances.some((entry) => {
              const openingStockNumber = Number(entry.quantity);
              return !Number.isFinite(openingStockNumber) || openingStockNumber < 0;
            });
            if (badOpening) invalidOpeningRows.push(comboLabel);
	            if (inFileSignatures.has(sig)) duplicateInFileRows.push(comboLabel);
	            inFileSignatures.add(sig);
	            if (existingSignatures.has(sig)) duplicateExistingRows.push(comboLabel);
	          }
		          if (duplicateInFileRows.length || duplicateExistingRows.length || invalidReorderRows.length || invalidOpeningRows.length) {
	            const dupInFile = Array.from(new Set(duplicateInFileRows));
	            const dupExisting = Array.from(new Set(duplicateExistingRows));
	            const invalidReorder = Array.from(new Set(invalidReorderRows));
            const invalidOpening = Array.from(new Set(invalidOpeningRows));
	            const issues: ItemUploadIssue[] = [
              ...dupInFile.map((combination) => ({
                type: 'duplicate_in_file' as const,
                combination,
                message: 'Duplicate combination found in uploaded file.',
              })),
              ...dupExisting.map((combination) => ({
                type: 'already_exists' as const,
	                combination,
	                message: 'This item combination already exists in system.',
	              })),
	              ...invalidReorder.map((combination) => ({
	                type: 'invalid_reorder_level' as const,
	                combination,
	                message: 'Re-Order Level must be blank or a non-negative number.',
	              })),
              ...invalidOpening.map((combination) => ({
                type: 'create_failed' as const,
                combination,
                message: 'Opening Stock must be blank or a non-negative number.',
              })),
		            ];
            setItemUploadIssues(issues);
            setTemplateError('Validation failed. Please correct the template and upload again.');
            setTemplateInfo(null);
            return;
          }
          setItemUploadIssues([]);
          const specValueSetBySpecId = new Map<string, Set<string>>();
          for (const spec of specs) {
            try {
              const values = await fetchSpecificationValues(spec.id);
              specValueSetBySpecId.set(spec.id, new Set(values.map((v) => normalizeKey(v.value))));
            } catch {
              specValueSetBySpecId.set(spec.id, new Set());
            }
          }
          for (const row of rows) {
            const itemNameId = itemNameIdByName.get(normalizeKey(row.itemName));
            const combination = formatCombo(row.itemName, row.specs);
            if (!itemNameId) {
              failures.push({
                type: 'item_name_missing',
                combination,
                message: 'Item name does not exist.',
              });
              continue;
            }
            const existingUnitKey = itemNameUnitByName.get(normalizeKey(row.itemName)) ?? '';
            const incomingUnitKey = normalizeKey(row.unitName);
            if (incomingUnitKey && existingUnitKey && incomingUnitKey !== existingUnitKey) {
              failures.push({
                type: 'unit_mismatch',
                combination,
                message: `Unit mismatch: existing "${existingUnitKey}", uploaded "${incomingUnitKey}".`,
              });
              continue;
            }
            for (const specRow of row.specs) {
              const specId = specRow.specificationId;
              const specValueKey = normalizeKey(specRow.value);
              if (!specId || !specValueKey) continue;
              const existingSet = specValueSetBySpecId.get(specId) ?? new Set<string>();
              if (!existingSet.has(specValueKey)) {
                try {
                  await createSpecificationValue({ specificationId: specId, value: specRow.value, createdBy: 'system' });
                } catch {
                  // ignore duplicate race/errors if value was inserted in parallel
                }
                existingSet.add(specValueKey);
                specValueSetBySpecId.set(specId, existingSet);
              }
            }
            try {
	              await createItem({
	                itemNameId,
	                unit: row.unitName || undefined,
	                description: row.description || undefined,
	                reorderLevel: row.reorderLevel.trim() ? Number(row.reorderLevel) : null,
                openingStock: row.storeOpeningBalances.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0),
                storeOpeningBalances: row.storeOpeningBalances
                  .filter((entry) => Number(entry.quantity) > 0)
                  .map((entry) => ({ storeName: entry.storeName, quantity: Number(entry.quantity) })),
	                specs: row.specs,
	                createdBy: 'system',
	              });
              created += 1;
            } catch (e) {
              failures.push({
                type: 'create_failed',
                combination,
                message: e instanceof Error ? e.message : String(e),
              });
            }
          }
          await refreshCurrentTab('items');
          const message = `Upload complete. Created: ${created}, Failed: ${failures.length}.`;
	          setItemUploadIssues(failures);
	          setTemplateInfo(message);
	        }

          async function showItemOpeningStockByStore(itemId: string, itemLabel: string) {
            try {
              const res = await fetch(`/api/masters/items/${encodeURIComponent(itemId)}/opening-balances`);
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(String((data as any)?.error ?? `Failed to load opening balances (${res.status})`));
              const balances = Array.isArray((data as any)?.balances) ? (data as any).balances : [];
              if (!balances.length) {
                window.alert(`${itemLabel}\n\nNo store-wise opening balances found.`);
                return;
              }
              const lines = balances.map((b: any) => `${String(b.storeName ?? b.storeId ?? '-')} : ${Number(b.quantity ?? 0)}`);
              window.alert(`${itemLabel}\n\n${lines.join('\n')}`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : String(e));
            }
          }

        async function createMissingItemNamesAndContinue() {
          try {
            if (!pendingItemUploadRows?.length || !missingItemNames.length) return;
            const missingCategory = missingItemNames.find((x) => !x.itemCategoryId);
            if (missingCategory) {
              setTemplateError(`Select item category for "${missingCategory.name}" before continuing.`);
              return;
            }
            setTemplateBusy(true);
            setTemplateError(null);
            setTemplateInfo(null);
            const existing = new Set(itemNames.map((n) => normalizeKey(n.name)));
            for (const row of missingItemNames) {
              if (!row.name.trim()) continue;
              const key = normalizeKey(row.name);
              if (existing.has(key)) continue;
              await createItemName({
                name: row.name.trim(),
                unitId: row.unitId || null,
                itemCategoryId: row.itemCategoryId || null,
                createdBy: 'system',
              });
              existing.add(key);
            }
            const updatedNames = await fetchItemNames();
            setItemNames(updatedNames);
            setMissingItemNames([]);
            await importItemRows(pendingItemUploadRows);
            setPendingItemUploadRows(null);
          } catch (e) {
            setTemplateError(e instanceof Error ? e.message : String(e));
          } finally {
            setTemplateBusy(false);
          }
        }

        async function downloadCurrentTemplate() {
          try {
            setTemplateBusy(true);
            setTemplateError(null);
            setTemplateInfo(null);
            setItemUploadIssues([]);
	            if (tab === 'items') {
		              const specColumns = specs.map((s) => s.name);
                  const storeColumns = stores.map((s) => `Opening Stock - ${s.name}`);
		              const header = ['item_name', 'description', 'unit', 'item_category', ...specColumns, ...storeColumns, 'Re-Order Level'];
		              const sampleRow: Record<string, string> = {
		                item_name: '',
		                description: '',
		                unit: '',
		                item_category: '',
	                  'Re-Order Level': '',
		              };
	              for (const col of specColumns) sampleRow[col] = '';
                  for (const col of storeColumns) sampleRow[col] = '';
	              downloadTextFile('items-template.csv', toCsv(header, [sampleRow]), 'text/csv; charset=utf-8');
	              setTemplateInfo('Template downloaded.');
	              return;
	            }
            const key = apiKeyForTab(tab);
            const res = await fetch(`/api/masters/${encodeURIComponent(key)}/template`);
            const text = await res.text();
            if (!res.ok) throw new Error(text || `Failed to download template (${res.status})`);
            downloadTextFile(`${key}-template.csv`, text, 'text/csv; charset=utf-8');
            setTemplateInfo('Template downloaded.');
          } catch (e) {
            setTemplateError(e instanceof Error ? e.message : String(e));
          } finally {
            setTemplateBusy(false);
          }
        }

        async function downloadItemNameItemsTemplate(itemNameId: string, itemNameLabel: string) {
          try {
            setTemplateBusy(true);
            setTemplateError(null);
            setTemplateInfo(null);
            const res = await fetch(`/api/masters/item-names/${encodeURIComponent(itemNameId)}/items-template`);
            const text = await res.text();
            if (!res.ok) throw new Error(text || `Failed to download template (${res.status})`);
            const safe = String(itemNameLabel ?? 'item-name')
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '') || 'item-name';
            downloadTextFile(`${safe}-items-template.csv`, text, 'text/csv; charset=utf-8');
            setTemplateInfo(`Template downloaded for "${itemNameLabel}".`);
          } catch (e) {
            setTemplateError(e instanceof Error ? e.message : String(e));
          } finally {
            setTemplateBusy(false);
          }
        }

        async function uploadTemplateFile(file: File) {
          try {
            setTemplateBusy(true);
            setTemplateError(null);
            setTemplateInfo(null);
            setItemUploadIssues([]);
            setPendingItemUploadRows(null);
            setMissingItemNames([]);
            const content = await file.text();
            const parsed = parseCsv(content);
            if (!parsed.rows.length) throw new Error('Template file is empty.');
            if (tab === 'items') {
              const headerMap = new Map(parsed.header.map((h) => [normalizeKey(h), h]));
              const itemNameColumn = headerMap.get('item_name') ?? headerMap.get('itemname') ?? headerMap.get('item name');
              if (!itemNameColumn) throw new Error('Missing required column: item_name');
              const descriptionColumn = headerMap.get('description') ?? '';
	              const unitColumn = headerMap.get('unit') ?? '';
	              const categoryColumn = headerMap.get('item_category') ?? headerMap.get('item category') ?? '';
	              const reorderColumn =
	                headerMap.get('re-order level') ??
	                headerMap.get('reorder level') ??
	                headerMap.get('reorder_level') ??
	                headerMap.get('reorderlevel') ??
	                '';
                const storeColumns = stores.map((store) => {
                  const key = normalizeKey(`Opening Stock - ${store.name}`);
                  const col = headerMap.get(key);
                  return col ? { storeName: store.name, column: col } : null;
                }).filter(Boolean) as Array<{ storeName: string; column: string }>;
              const specIdByColumn = new Map<string, string>();
              for (const s of specs) {
                const col = headerMap.get(normalizeKey(s.name));
                if (col) specIdByColumn.set(col, s.id);
              }
              const rows = parsed.rows
                .map((r) => {
                  const itemName = String(r[itemNameColumn] ?? '').trim();
                  const description = descriptionColumn ? String(r[descriptionColumn] ?? '').trim() : '';
	                  const unitName = unitColumn ? String(r[unitColumn] ?? '').trim() : '';
	                  const itemCategoryName = categoryColumn ? String(r[categoryColumn] ?? '').trim() : '';
	                  const reorderLevel = reorderColumn ? String(r[reorderColumn] ?? '').trim() : '';
                    const storeOpeningBalances = storeColumns
                      .map(({ storeName, column }) => ({ storeName, quantity: String(r[column] ?? '').trim() }))
                      .filter((entry) => entry.quantity);
			                  const rowSpecs = Array.from(specIdByColumn.entries())
		                    .map(([col, specId]) => ({ specificationId: specId, value: String(r[col] ?? '').trim() }))
		                    .filter((x) => x.value);
			                  return { itemName, description, unitName, itemCategoryName, reorderLevel, storeOpeningBalances, specs: rowSpecs };
		                })
                .filter((r) => r.itemName);
              if (!rows.length) throw new Error('No valid item rows found in file.');
              const itemNameSet = new Set(itemNames.map((n) => normalizeKey(n.name)));
              const unitIdByName = new Map(units.map((u) => [normalizeKey(u.name), u.id]));
              const categoryIdByName = new Map(itemCategories.map((c) => [normalizeKey(c.name), c.id]));
              const missing = Array.from(new Set(rows.map((r) => r.itemName).filter((n) => !itemNameSet.has(normalizeKey(n)))));
              if (missing.length) {
                const defaults = missing.map((name) => {
                  const source = rows.find((r) => normalizeKey(r.itemName) === normalizeKey(name));
                  const unitId = source?.unitName ? unitIdByName.get(normalizeKey(source.unitName)) ?? '' : '';
                  const itemCategoryId = source?.itemCategoryName ? categoryIdByName.get(normalizeKey(source.itemCategoryName)) ?? '' : '';
                  return { name, unitId, itemCategoryId };
                });
                setPendingItemUploadRows(rows);
                setMissingItemNames(defaults);
                setTemplateInfo(`Found ${missing.length} missing item names. Create them below to continue upload.`);
                return;
              }
              await importItemRows(rows);
              return;
            }
            const key = apiKeyForTab(tab);
            const res = await fetch(`/api/masters/${encodeURIComponent(key)}/import`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: parsed.rows }),
            });
            const data = await (async () => {
              try {
                return await res.json();
              } catch {
                return null;
              }
            })();
            if (!res.ok) {
              const duplicates = Array.isArray((data as any)?.duplicates) ? (data as any).duplicates : null;
              if (duplicates?.length) throw new Error(`Duplicates found: ${duplicates.join(', ')}`);
              const unknownFirms = (data as any)?.unknownFirms;
              if (Array.isArray(unknownFirms) && unknownFirms.length) throw new Error(`Unknown firms: ${unknownFirms.join(', ')}`);
              const unknownUnits = (data as any)?.unknownUnits;
              if (Array.isArray(unknownUnits) && unknownUnits.length) throw new Error(`Unknown units: ${unknownUnits.join(', ')}`);
              const unknownItemCategories = (data as any)?.unknownItemCategories;
              if (Array.isArray(unknownItemCategories) && unknownItemCategories.length) throw new Error(`Unknown item categories: ${unknownItemCategories.join(', ')}`);
              const unknownSpecifications = (data as any)?.unknownSpecifications;
              if (Array.isArray(unknownSpecifications) && unknownSpecifications.length) throw new Error(`Unknown specifications: ${unknownSpecifications.join(', ')}`);
              const unknownItemNames = (data as any)?.unknownItemNames;
              if (Array.isArray(unknownItemNames) && unknownItemNames.length) throw new Error(`Unknown item names: ${unknownItemNames.join(', ')}`);
              throw new Error((data as any)?.error ? String((data as any).error) : `Upload failed (${res.status})`);
            }
            await refreshCurrentTab(tab);
            setTemplateInfo('Template uploaded successfully.');
          } catch (e) {
            setTemplateError(e instanceof Error ? e.message : String(e));
          } finally {
            setTemplateBusy(false);
          }
        }

        function exportCurrentTab() {
          const key = apiKeyForTab(tab);
          const stamp = new Date().toISOString().slice(0, 10);
          if (tab === 'firms') {
            const header = ['name', 'sortName', 'cin', 'gstNumber', 'address', 'phone', 'logoUrl', 'termsConditions'];
            const rows = firms.map((f) => ({
              name: f.name,
              sortName: f.sortName ?? '',
              cin: f.cin ?? '',
              gstNumber: f.gstNumber ?? '',
              address: f.address ?? '',
              phone: f.phone ?? '',
              logoUrl: f.logoUrl ?? '',
              termsConditions: f.termsConditions ?? '',
            }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
          if (tab === 'stores') {
            const header = ['firmId', 'name', 'location'];
            const rows = stores.map((s) => ({ firmId: s.firmId, name: s.name, location: s.location ?? '' }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
          if (tab === 'departments') {
            const header = ['name'];
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, departments.map((d) => ({ name: d.name }))), 'text/csv; charset=utf-8');
          }
	          if (tab === 'users') {
	            const header = ['name', 'loginId', 'role', 'status', 'email', 'mobile', 'menuAccess'];
	            const rows = users.map((u) => ({
	              name: u.name,
	              loginId: String((u as any).loginId ?? ''),
	              role: String((u as any).role ?? u.designation ?? ''),
	              status: (u as any).isActive === false ? 'Inactive' : 'Active',
	              email: u.email ?? '',
	              mobile: u.mobile ?? '',
	              menuAccess: JSON.stringify(Array.isArray((u as any).menuAccess) ? (u as any).menuAccess : []),
	            }));
	            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
	          }
          if (tab === 'suppliers') {
            const header = ['name', 'gstNumber', 'gstType', 'address', 'phone', 'paymentTerms'];
            const rows = suppliers.map((s) => ({
              name: s.name,
              gstNumber: s.gstNumber ?? '',
              gstType: s.gstType ?? '',
              address: s.address ?? '',
              phone: s.phone ?? '',
              paymentTerms: s.paymentTerms ?? '',
            }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
          if (tab === 'customers') {
            const header = ['name', 'categoryName', 'subCategoryName', 'city', 'state', 'contactPerson', 'contactNumber', 'emailId'];
            const rows = customers.map((c) => ({
              name: c.name,
              categoryName: (c as any).categoryName ?? '',
              subCategoryName: (c as any).subCategoryName ?? '',
              city: (c as any).city ?? '',
              state: (c as any).state ?? '',
              contactPerson: (c as any).contactPerson ?? '',
              contactNumber: (c as any).contactNumber ?? '',
              emailId: (c as any).emailId ?? '',
            }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
          if (tab === 'transporters') {
            const header = ['name', 'phone'];
            const rows = transporters.map((t) => ({ name: t.name, phone: t.phone ?? '' }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
          if (tab === 'projects') {
            const header = ['firmId', 'name', 'clientName', 'startDate', 'endDate', 'status'];
            const rows = projects.map((p) => ({
              firmId: p.firmId,
              name: p.name,
              clientName: p.clientName ?? '',
              startDate: p.startDate ?? '',
              endDate: p.endDate ?? '',
              status: p.status ?? '',
            }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
	          if (tab === 'units') {
	            const header = ['name'];
	            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, units.map((u) => ({ name: u.name }))), 'text/csv; charset=utf-8');
	          }
            if (tab === 'priorities') {
              const header = ['name'];
              return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, priorities.map((p) => ({ name: p.name }))), 'text/csv; charset=utf-8');
            }
	          if (tab === 'itemCategories') {
            const header = ['name'];
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, itemCategories.map((c) => ({ name: c.name }))), 'text/csv; charset=utf-8');
          }
	          if (tab === 'itemNames') {
	            const header = ['name', 'unitName', 'itemCategoryName', 'specifications'];
	            const rows = itemNames.map((n) => {
	              const ids = Array.isArray((n as any).specificationIds) ? ((n as any).specificationIds as any[]).map((x) => String(x)) : [];
	              const specsText = ids
	                .map((id) => specNameLookup[id] ?? id)
	                .filter(Boolean)
	                .join(', ');
	              return { name: n.name, unitName: n.unitName ?? '', itemCategoryName: n.itemCategoryName ?? '', specifications: specsText };
	            });
	            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
	          }
          if (tab === 'specs') {
            const header = ['name'];
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, specs.map((s) => ({ name: s.name }))), 'text/csv; charset=utf-8');
          }
          if (tab === 'specValues') {
            const header = ['specificationId', 'value', 'isActive'];
            const rows = specValues.map((v) => ({ specificationId: v.specificationId, value: v.value, isActive: v.isActive ? 'true' : 'false' }));
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
	          if (tab === 'items') {
                const storeColumns = stores.map((s) => `Opening Stock - ${s.name}`);
		            const header = ['item_name', 'description', 'unit', 'item_category', ...specs.map((s) => s.name), ...storeColumns, 'Re-Order Level'];
	            const rows = items.map((it) => {
              const specObj = (() => {
                try {
                  const parsed = JSON.parse(it.specificationsJson || '{}');
                  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
                } catch {
                  return {};
                }
              })();
              const specByName = Object.fromEntries(
                Object.entries(specObj).map(([specId, value]) => [specNameLookup[String(specId)] ?? String(specId), String(value ?? '')])
              );
              return {
                item_name: it.itemName,
                description: it.description ?? '',
                unit: it.unit ?? '',
	                item_category: itemNames.find((n) => n.id === it.itemNameId)?.itemCategoryName ?? '',
	                ...Object.fromEntries(specs.map((s) => [s.name, specByName[s.name] ?? ''])),
                    ...Object.fromEntries(storeColumns.map((col) => [col, ''])),
		                  'Re-Order Level': it.reorderLevel ?? '',
			              };
	            });
            return downloadTextFile(`${key}-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
          }
        }

	  return (
	    <div className="space-y-4">
			      {error && !addOpen ? (
            <div className="rounded-lg border border-error/40 bg-error/5 p-3 space-y-2">
              <div className="text-xs font-semibold text-error">{error}</div>
              {error.startsWith('Cannot delete') && deleteUsageDetails.length ? (
                <div className="overflow-auto">
                  <table className="min-w-[420px] text-xs border-collapse border border-error/40 bg-surface-container-lowest">
                    <thead>
                      <tr>
                        <th className="text-left px-3 py-2 border border-error/40">Used In</th>
                        <th className="text-left px-3 py-2 border border-error/40">Name / Number</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deleteUsageDetails.map((row, idx) => (
                        <tr key={`${row.usedIn}-${row.name}-${idx}`}>
                          <td className="px-3 py-2 border border-error/40">{row.usedIn || '-'}</td>
                          <td className="px-3 py-2 border border-error/40">{row.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={exportCurrentTab}>
              Export Excel
            </button>
            <button type="button" className="btn btn-sm" disabled={templateBusy} onClick={downloadCurrentTemplate}>
              Download Template
            </button>
            <label className={templateBusy ? 'btn btn-sm opacity-60 cursor-not-allowed' : 'btn btn-sm cursor-pointer'}>
              Upload Template
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={templateBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  uploadTemplateFile(f);
                }}
              />
            </label>
            {templateInfo ? <span className="text-xs text-on-surface-variant">{templateInfo}</span> : null}
            {templateError ? <span className="text-xs text-error">{templateError}</span> : null}
            </div>
          </div>
          {tab === 'items' && missingItemNames.length ? (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4 space-y-3">
              <div className="text-sm font-semibold text-on-surface">Missing Item Names Found</div>
              <div className="text-xs text-on-surface-variant">Create these item names first, then upload will continue automatically.</div>
              <div className="overflow-auto">
                <table className="min-w-[760px] w-full text-sm border-collapse border border-blue-600">
                  <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="text-left px-3 py-2 border border-blue-600">Item Name</th>
                      <th className="text-left px-3 py-2 border border-blue-600">Unit</th>
                      <th className="text-left px-3 py-2 border border-blue-600">Item Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingItemNames.map((row, idx) => (
                      <tr key={`${row.name}-${idx}`}>
                        <td className="px-3 py-2 border border-blue-600">{row.name}</td>
                        <td className="px-3 py-2 border border-blue-600">
                          <SearchableSelect
                            value={row.unitId}
                            options={[{ value: '', label: 'Select Unit' }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
                            onChange={(value) => setMissingItemNames((prev) => prev.map((p, i) => (i === idx ? { ...p, unitId: value } : p)))}
                            placeholder="Select Unit"
                          />
                        </td>
                        <td className="px-3 py-2 border border-blue-600">
                          <SearchableSelect
                            value={row.itemCategoryId}
                            options={[{ value: '', label: 'Select Category' }, ...itemCategories.map((c) => ({ value: c.id, label: c.name }))]}
                            onChange={(value) => setMissingItemNames((prev) => prev.map((p, i) => (i === idx ? { ...p, itemCategoryId: value } : p)))}
                            placeholder="Select Category"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-sm" disabled={templateBusy} onClick={createMissingItemNamesAndContinue}>
                  Create Missing Item Names & Continue Upload
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={templateBusy}
                  onClick={() => {
                    setPendingItemUploadRows(null);
                    setMissingItemNames([]);
                    setTemplateInfo('Pending upload cancelled.');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {tab === 'items' && itemUploadIssues.length ? (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-4 space-y-3">
              <div className="text-sm font-semibold text-on-surface">Upload Failures</div>
              <div className="overflow-auto">
                <table className="min-w-[980px] w-full text-sm border-collapse border border-blue-600">
                  <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="text-left px-3 py-2 border border-blue-600">Type</th>
                      <th className="text-left px-3 py-2 border border-blue-600">Item Combination</th>
                      <th className="text-left px-3 py-2 border border-blue-600">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemUploadIssues.map((issue, idx) => (
                      <tr key={`${issue.type}-${issue.combination}-${idx}`}>
                        <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">{issue.type}</td>
                        <td className="px-3 py-2 border border-blue-600">{issue.combination}</td>
                        <td className="px-3 py-2 border border-blue-600">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

				      {addOpen ? (
			        <div className="fixed inset-0 z-50 flex items-stretch justify-center py-4 px-8 md:px-12">
			          <button
			            type="button"
			            className="absolute inset-0 bg-black/40"
			            aria-label="Close"
			            onClick={closeModal}
			          />
			          <div className="relative w-full max-w-5xl h-full bg-surface-container-lowest border border-outline-variant shadow-xl flex flex-col rounded-2xl overflow-hidden">
			            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
			              <div className="text-sm font-bold text-on-surface">{addTitle}</div>
			              <button
			                type="button"
	                className="btn btn-sm"
	                onClick={closeModal}
	              >
	                Close
	              </button>
	            </div>

			            <div className="flex-1 min-h-0 overflow-auto p-5 space-y-3">
                    {error ? (
                      <div className="rounded-lg border border-error/40 bg-error/5 p-3">
                        <div className="text-xs font-semibold text-error">{error}</div>
                      </div>
                    ) : null}
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

				                  <div className="grid grid-cols-1 gap-3">
				                    <label className="space-y-1">
			                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Sort Name</div>
			                      <input
			                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                        value={newFirmSortName}
			                        onChange={(e) => setNewFirmSortName(e.target.value)}
			                        placeholder="Sort Name"
			                      />
			                    </label>

			                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">CIN</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        value={newFirmCin}
		                        onChange={(e) => setNewFirmCin(e.target.value)}
		                        placeholder="CIN"
		                      />
		                    </label>

		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">GST</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        value={newFirmGstNumber}
		                        onChange={(e) => setNewFirmGstNumber(e.target.value)}
		                        placeholder="GST No."
		                      />
		                    </label>

		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Address</div>
		                      <textarea
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none min-h-[80px]"
		                        value={newFirmAddress}
		                        onChange={(e) => setNewFirmAddress(e.target.value)}
		                        placeholder="Address"
		                      />
		                    </label>

			                    <label className="space-y-1">
			                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm Phone Number</div>
			                      <input
			                        className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.firmPhone ? 'border-error/60' : 'border-outline-variant/20'}`}
			                        value={newFirmPhone}
			                        onChange={(e) => {
			                          clearFieldError('firmPhone');
			                          setNewFirmPhone(normalizeTenDigitPhoneInput(e.target.value));
			                        }}
			                        placeholder="Phone"
			                        inputMode="numeric"
			                        maxLength={10}
			                        pattern="[0-9]{10}"
			                      />
			                      {fieldErrors.firmPhone ? <div className="text-xs text-error">{fieldErrors.firmPhone}</div> : null}
			                    </label>

				                    <label className="space-y-1">
			                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Logo (Upload or URL)</div>
			                      <div className="flex flex-col gap-2">
				                        <input
				                          type="file"
				                          className="block w-full text-sm text-on-surface file:mr-3 file:rounded-md file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-black/90"
				                          accept="image/png,image/jpeg"
				                          disabled={busy}
			                          onChange={(e) => {
			                            const file = e.target.files?.[0];
			                            if (!file) return;
			                            const maxBytes = 2 * 1024 * 1024; // 2MB
			                            if (file.size > maxBytes) {
			                              setError('Logo image is too large. Please upload a PNG/JPG under 2MB.');
			                              return;
			                            }
			                            if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
			                              setError('Logo must be a PNG or JPG image.');
			                              return;
			                            }
			                            const reader = new FileReader();
			                            reader.onload = () => setNewFirmLogoUrl(String(reader.result ?? ''));
			                            reader.onerror = () => setError('Failed to read image file.');
			                            reader.readAsDataURL(file);
			                          }}
			                        />
			                        <input
			                          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                          value={newFirmLogoUrl}
			                          onChange={(e) => setNewFirmLogoUrl(e.target.value)}
			                          placeholder="Paste direct .png/.jpg URL or data:image/... (upload recommended for PDF)"
			                        />
			                        {String(newFirmLogoUrl ?? '').trim() ? (
			                          <div className="flex items-center gap-3">
			                            <img
			                              src={String(newFirmLogoUrl)}
			                              alt="Firm logo preview"
			                              className="h-12 w-auto rounded bg-white border border-outline-variant/20"
			                              onError={(ev) => {
			                                (ev.currentTarget as HTMLImageElement).style.display = 'none';
			                              }}
			                            />
			                            <div className="text-xs text-on-surface-variant">
			                              Upload PNG/JPG to ensure it shows in PO PDF.
			                            </div>
			                          </div>
			                        ) : null}
			                      </div>
			                    </label>

		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Terms &amp; Conditions</div>
		                      <textarea
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none min-h-[100px]"
		                        value={newFirmTermsConditions}
		                        onChange={(e) => setNewFirmTermsConditions(e.target.value)}
		                        placeholder="Default terms & conditions for this firm"
		                      />
		                    </label>
		                  </div>

			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
			                      className="btn btn-sm"
				                      onClick={() => {
				                        setNewFirmName('');
				                        setNewFirmSortName('');
				                        setNewFirmCin('');
			                        setNewFirmGstNumber('');
			                        setNewFirmAddress('');
			                        setNewFirmPhone('');
			                        setNewFirmLogoUrl('');
			                        setNewFirmTermsConditions('');
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
			                        setFieldErrors({});
			                        const phone = newFirmPhone.trim();
			                        if (phone && !isValidTenDigitPhone(phone)) {
			                          setBusy(false);
			                          setFieldError('firmPhone', 'Must be a 10 digit number.');
			                          return;
			                        }
			                        const fn = isEditing
		                          ? updateFirm(editCtx?.id ?? '', {
		                              name: newFirmName.trim(),
		                              sortName: newFirmSortName.trim() || null,
		                              cin: newFirmCin.trim() || null,
		                              gstNumber: newFirmGstNumber.trim() || null,
		                              address: newFirmAddress.trim() || null,
			                              phone: phone || null,
			                              logoUrl: newFirmLogoUrl.trim() || null,
			                              termsConditions: newFirmTermsConditions.trim() || null,
			                              updatedBy: 'system',
			                            })
		                          : createFirm({
		                              name: newFirmName.trim(),
		                              sortName: newFirmSortName.trim() || null,
		                              cin: newFirmCin.trim() || null,
		                              gstNumber: newFirmGstNumber.trim() || null,
		                              address: newFirmAddress.trim() || null,
			                              phone: phone || null,
			                              logoUrl: newFirmLogoUrl.trim() || null,
			                              termsConditions: newFirmTermsConditions.trim() || null,
			                              createdBy: 'system',
			                            });
		                        fn
		                          .then(() => refreshCurrentTab(tab))
				                          .then(() => {
				                            setNewFirmName('');
				                            setNewFirmSortName('');
				                            setNewFirmCin('');
			                            setNewFirmGstNumber('');
			                            setNewFirmAddress('');
			                            setNewFirmPhone('');
			                            setNewFirmLogoUrl('');
			                            setNewFirmTermsConditions('');
			                            closeModal();
			                          })
		                          .catch(handleMasterError)
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
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Location</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newStoreLocation}
		                      onChange={(e) => setNewStoreLocation(e.target.value)}
		                      placeholder="Head Office / Site"
		                    />
		                  </label>
			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
			                      className="btn btn-sm"
			                      onClick={() => {
			                        setNewStoreFirmId('');
			                        setNewStoreName('');
			                        setNewStoreLocation('');
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
		                        if (busy) return;
		                        setBusy(true);
		                        setError(null);
		                        const fn = isEditing
		                          ? updateStore(editCtx?.id ?? '', {
		                              firmId: newStoreFirmId,
		                              name: newStoreName.trim(),
		                              location: newStoreLocation.trim() || undefined,
		                              updatedBy: 'system',
		                            })
		                          : createStore({ firmId: newStoreFirmId, name: newStoreName.trim(), location: newStoreLocation.trim() || undefined, createdBy: 'system' });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewStoreFirmId('');
		                            setNewStoreName('');
		                            setNewStoreLocation('');
		                            closeModal();
		                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
		                  </div>
	                </div>
		              ) : null}

		              {tab === 'projects' ? (
		                <div className="space-y-2">
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Firm</div>
		                    <SearchableSelect
		                      value={newProjectFirmId}
		                      options={firms.map((f) => ({ value: f.id, label: f.name }))}
		                      onChange={setNewProjectFirmId}
		                      placeholder="Search firm..."
		                    />
		                  </label>
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Project name</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newProjectName}
		                      onChange={(e) => setNewProjectName(e.target.value)}
		                      placeholder="Branding Work of Adani foundation"
		                    />
		                  </label>
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Customer name</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newProjectClientName}
		                      onChange={(e) => setNewProjectClientName(e.target.value)}
		                      placeholder="Adani foundation"
		                    />
		                  </label>
<div className="grid grid-cols-1 gap-3">
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        type="date"
		                        value={newProjectStartDate}
		                        onChange={(e) => setNewProjectStartDate(e.target.value)}
		                      />
		                    </label>
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">End date</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        type="date"
		                        value={newProjectEndDate}
		                        onChange={(e) => setNewProjectEndDate(e.target.value)}
		                      />
		                    </label>
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Status</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        value={newProjectStatus}
		                        onChange={(e) => setNewProjectStatus(e.target.value)}
		                        placeholder="Active"
		                      />
		                    </label>
		                  </div>
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="btn btn-sm"
		                      onClick={() => {
		                        setNewProjectName('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newProjectFirmId || !newProjectName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
		                        const payload = {
		                          firmId: newProjectFirmId,
		                          name: newProjectName.trim(),
		                          clientName: newProjectClientName.trim() || null,
		                          startDate: newProjectStartDate.trim() || null,
		                          endDate: newProjectEndDate.trim() || null,
		                          status: newProjectStatus.trim() || null,
		                          updatedBy: 'system',
		                        };
		                        const fn = isEditing
		                          ? updateProject(editCtx?.id ?? '', payload)
		                          : createProject({ ...payload, createdBy: 'system' });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewProjectName('');
		                            closeModal();
		                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
		                      }}
		                    >
		                      {isEditing ? 'Save' : 'Add'}
		                    </button>
		                  </div>
		                </div>
		              ) : null}

				              {tab === 'departments' ? (
			                <div className="space-y-2">
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Department name</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newDepartmentName}
		                      onChange={(e) => setNewDepartmentName(e.target.value)}
		                      placeholder="Operations"
		                    />
		                  </label>
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="btn btn-sm"
		                      onClick={() => {
		                        setNewDepartmentName('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newDepartmentName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
		                        const fn = isEditing
		                          ? updateDepartment(editCtx?.id ?? '', { name: newDepartmentName.trim(), updatedBy: 'system' })
		                          : createDepartment({ name: newDepartmentName.trim(), createdBy: 'system' });
		                        fn
		                          .then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewDepartmentName('');
		                            closeModal();
		                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
		                      }}
		                    >
		                      {isEditing ? 'Save' : 'Add'}
		                    </button>
		                  </div>
			                </div>
				      ) : null}

				              {tab === 'states' ? (
			                <div className="space-y-2">
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">State</div>
			                    <input
			                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                      value={newStateName}
			                      onChange={(e) => setNewStateName(e.target.value)}
			                      placeholder="Assam"
			                    />
			                  </label>
			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
			                      className="btn btn-sm"
			                      onClick={() => {
			                        setNewStateName('');
			                        closeModal();
			                      }}
			                    >
			                      Cancel
			                    </button>
			                    <button
			                      type="button"
			                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                      disabled={!newStateName.trim() || busy}
			                      onClick={() => {
			                        setBusy(true);
			                        setError(null);
			                        const fn = isEditing
			                          ? updateState(editCtx?.id ?? '', { name: newStateName.trim(), updatedBy: 'system' })
			                          : createState({ name: newStateName.trim(), createdBy: 'system' });
			                        fn
			                          .then(() => refreshCurrentTab('states'))
			                          .then(() => {
			                            setNewStateName('');
			                            closeModal();
			                          })
			                          .catch(handleMasterError)
			                          .finally(() => setBusy(false));
			                      }}
			                    >
			                      {isEditing ? 'Save' : 'Add'}
			                    </button>
			                  </div>
			                </div>
				      ) : null}

				              {tab === 'cities' ? (
			                <div className="space-y-2">
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">State</div>
			                    <SearchableSelect
			                      value={newCityState}
			                      options={states
                                .slice()
                                .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }))
                                .map((s) => ({ value: s.name, label: s.name }))}
			                      onChange={(v) => {
			                        setNewCityState(v);
			                      }}
			                      placeholder="Select state..."
			                      onCreate={async (label) => {
			                        const name = label.trim();
			                        if (!name) return null;
			                        const created = await createState({ name, createdBy: 'system' });
			                        const next = created.state;
			                        if (!next?.id) return null;
			                        await refreshCurrentTab('states');
			                        setNewCityState(next.name);
			                        return { value: next.name, label: next.name };
			                      }}
			                    />
			                  </label>
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">City</div>
			                    <input
			                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                      value={newCityName}
			                      onChange={(e) => setNewCityName(e.target.value)}
			                      placeholder="Guwahati"
			                    />
			                  </label>
			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
			                      className="btn btn-sm"
			                      onClick={() => {
			                        setNewCityState('');
			                        setNewCityName('');
			                        closeModal();
			                      }}
			                    >
			                      Cancel
			                    </button>
			                    <button
			                      type="button"
			                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                      disabled={!newCityState.trim() || !newCityName.trim() || busy}
			                      onClick={() => {
			                        setBusy(true);
			                        setError(null);
			                        const fn = isEditing
			                          ? updateCity(editCtx?.id ?? '', { state: newCityState.trim(), name: newCityName.trim(), updatedBy: 'system' })
			                          : createCity({ state: newCityState.trim(), name: newCityName.trim(), createdBy: 'system' });
			                        fn
			                          .then(() => refreshCurrentTab('cities'))
			                          .then(() => {
			                            setNewCityState('');
			                            setNewCityName('');
			                            closeModal();
			                          })
			                          .catch(handleMasterError)
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
	                  <div className="grid grid-cols-1 gap-3">
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
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Login ID</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                        value={newUserLoginId}
		                        onChange={(e) => setNewUserLoginId(e.target.value)}
		                        placeholder="amit"
		                      />
		                    </label>

		                    <div className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Role</div>
		                      <div className="flex items-center gap-2">
		                        <select
		                          className="flex-1 w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                          value={newUserRole}
		                          onChange={(e) => setNewUserRole(e.target.value)}
		                        >
		                          <option value="">Select role</option>
		                          {userRoleOptions.map((r) => (
		                            <option key={r} value={r}>
		                              {r}
		                            </option>
		                          ))}
		                        </select>
		                        <button
		                          type="button"
		                          title="Add role"
		                          aria-label="Add role"
		                          className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-on-primary shadow-sm hover:bg-primary/90 transition-colors"
		                          onClick={() => {
		                            const v = window.prompt('Enter role name');
		                            const role = String(v ?? '').trim();
		                            if (!role) return;
		                            setExtraUserRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
		                            setNewUserRole(role);
		                          }}
		                        >
		                          <Plus size={16} />
		                        </button>
		                      </div>
		                    </div>
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile</div>
			                      <input
			                        className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.userMobile ? 'border-error/60' : 'border-outline-variant/20'}`}
		                        value={newUserMobile}
		                        onChange={(e) => {
		                          clearFieldError('userMobile');
		                          setNewUserMobile(normalizeTenDigitPhoneInput(e.target.value));
		                        }}
		                        placeholder="9876543210"
		                        inputMode="numeric"
		                        maxLength={10}
		                        pattern="[0-9]{10}"
		                      />
		                      {fieldErrors.userMobile ? <div className="text-xs text-error">{fieldErrors.userMobile}</div> : null}
		                    </label>
                        <label className="space-y-1">
                          <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">PO Approval Amount</div>
                          <input
                            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                            value={newUserPoApprovalAmount}
                            onChange={(e) => setNewUserPoApprovalAmount(e.target.value.replace(/[^\d.]/g, ''))}
                            placeholder="0"
                            inputMode="decimal"
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

		                  <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-3">
		                    <div className="flex items-center justify-between gap-2">
		                      <div className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Menu Access</div>
		                      <div className="flex items-center gap-2">
		                        <button
		                          type="button"
		                          className="btn btn-sm"
		                          onClick={() => setNewUserMenuAccess(sidebarPermissionKeys)}
		                        >
		                          Select All
		                        </button>
		                        <button type="button" className="btn btn-sm" onClick={() => setNewUserMenuAccess([])}>
		                          Clear
		                        </button>
		                      </div>
		                    </div>
		                    <div className="space-y-4">
		                      {menuAccessCategories.map((cat) => {
		                        const catKeys = cat.items.map((x) => x.key);
		                        return (
		                          <div key={cat.id} className="rounded-lg border border-outline-variant/10 p-3 bg-surface-container-low">
		                            <div className="flex items-center justify-between gap-2 mb-2">
		                              <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
		                                {cat.title}
		                              </div>
		                              <div className="flex items-center gap-2">
		                                <button
		                                  type="button"
		                                  className="btn btn-sm"
		                                  onClick={() =>
		                                    setNewUserMenuAccess((prev) => {
		                                      const set = new Set(prev);
		                                      catKeys.forEach((k) => set.add(k));
		                                      return Array.from(set);
		                                    })
		                                  }
		                                >
		                                  Select
		                                </button>
		                                <button
		                                  type="button"
		                                  className="btn btn-sm"
		                                  onClick={() => setNewUserMenuAccess((prev) => prev.filter((k) => !catKeys.includes(k)))}
		                                >
		                                  Clear
		                                </button>
		                              </div>
		                            </div>
		                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
		                              {cat.items.map((item) => {
		                                const checked = newUserMenuAccess.includes(item.key);
		                                return (
		                                  <label key={item.key} className="flex items-center gap-2 text-sm text-on-surface">
		                                    <input
		                                      type="checkbox"
		                                      checked={checked}
		                                      onChange={() => {
		                                        setNewUserMenuAccess((prev) => {
		                                          if (prev.includes(item.key)) return prev.filter((k) => k !== item.key);
		                                          return [...prev, item.key];
		                                        });
		                                      }}
		                                    />
		                                    <span>{item.label}</span>
		                                  </label>
		                                );
		                              })}
		                            </div>
		                          </div>
		                        );
		                      })}
		                    </div>
		                  </div>

		                  <div className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">User Status</div>
		                    <div className="flex items-center gap-6">
		                      <label className="flex items-center gap-2 text-sm">
		                        <input type="radio" name="userStatus" checked={newUserIsActive} onChange={() => setNewUserIsActive(true)} />
		                        <span>Active</span>
		                      </label>
		                      <label className="flex items-center gap-2 text-sm">
		                        <input
		                          type="radio"
		                          name="userStatus"
		                          checked={!newUserIsActive}
		                          onChange={() => setNewUserIsActive(false)}
		                        />
		                        <span>Inactive</span>
		                      </label>
		                    </div>
		                  </div>

	                  <div className="pt-3 flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="btn btn-sm"
		                      onClick={() => {
		                        setNewUserName('');
		                        setNewUserEmail('');
		                        setNewUserLoginId('');
		                        setNewUserRole('');
		                        setNewUserMenuAccess([]);
		                        setNewUserIsActive(true);
		                        setNewUserPassword('');
		                        setNewUserMobile('');
                            setNewUserPoApprovalAmount('');
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
		                        !newUserLoginId.trim() ||
		                        !newUserRole.trim() ||
		                        (!isEditing && !newUserPassword.trim())
		                      }
				                      onClick={() => {
			                        setBusy(true);
			                        setError(null);
			                        setFieldErrors({});
			                        const mobile = newUserMobile.trim();
			                        if (mobile && !isValidTenDigitPhone(mobile)) {
			                          setBusy(false);
			                          setFieldError('userMobile', 'Must be a 10 digit number.');
			                          return;
			                        }
			                        const password = newUserPassword.trim();
			                        const fn = isEditing
			                          ? updateUser(editCtx?.id ?? '', {
			                              name: newUserName.trim(),
			                              email: newUserEmail.trim(),
			                              loginId: newUserLoginId.trim(),
			                              role: newUserRole.trim(),
			                              menuAccess: newUserMenuAccess.slice(),
			                              isActive: newUserIsActive,
			                              mobile: mobile || undefined,
                                poApprovalAmount: newUserPoApprovalAmount.trim() ? Number(newUserPoApprovalAmount) : null,
			                              password: password || undefined,
			                              updatedBy: 'system',
			                            })
			                          : createUser({
			                              name: newUserName.trim(),
			                              email: newUserEmail.trim(),
			                              loginId: newUserLoginId.trim(),
			                              role: newUserRole.trim(),
			                              menuAccess: newUserMenuAccess.slice(),
			                              isActive: newUserIsActive,
			                              mobile: mobile || undefined,
                                poApprovalAmount: newUserPoApprovalAmount.trim() ? Number(newUserPoApprovalAmount) : null,
			                              password,
			                              createdBy: 'system',
			                            });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewUserName('');
		                            setNewUserEmail('');
		                            setNewUserLoginId('');
		                            setNewUserRole('');
		                            setNewUserMenuAccess([]);
		                            setNewUserIsActive(true);
		                            setNewUserPassword('');
		                            setNewUserMobile('');
                                setNewUserPoApprovalAmount('');
		                            closeModal();
		                          })
	                          .catch(handleMasterError)
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
					                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Supplier name <span className="text-red-600">*</span></div>
				                    <input
			                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                      value={newSupplierName}
		                      onChange={(e) => setNewSupplierName(e.target.value)}
			                      placeholder="ABC Traders"
			                    />
			                  </label>

				                  <div className="grid grid-cols-1 gap-3">
			                    <label className="space-y-1">
			                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">GST</div>
			                      <input
			                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                        value={newSupplierGstNumber}
			                        onChange={(e) => setNewSupplierGstNumber(e.target.value)}
			                        placeholder="GST No."
			                      />
			                    </label>

				                    <label className="space-y-1">
					                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">GST Type {newSupplierGstNumber.trim() ? <span className="text-red-600">*</span> : null}</div>
					                      <SearchableSelect
					                        options={[
					                          { value: 'Intra-State', label: 'Intra-State' },
					                          { value: 'Inter-State', label: 'Inter-State' },
					                        ]}
					                        value={newSupplierGstType}
					                        onChange={(v) => setNewSupplierGstType(v === 'Inter-State' ? 'Inter-State' : 'Intra-State')}
					                        placeholder="Select GST type"
					                      />
					                    </label>

                          <label className="flex items-center gap-2 pt-2 select-none">
                            <input
                              type="checkbox"
                              checked={newSupplierCreditVoucherApplicable}
                              onChange={(e) => setNewSupplierCreditVoucherApplicable(Boolean(e.target.checked))}
                            />
                            <span className="text-sm text-on-surface-variant">Credit Voucher Applicable (invoice not required)</span>
                          </label>

	<label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Address</div>
				                      <textarea
			                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none min-h-[80px]"
			                        value={newSupplierAddress}
			                        onChange={(e) => setNewSupplierAddress(e.target.value)}
			                        placeholder="Address"
			                      />
			                    </label>

				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile 1</div>
				                      <input
				                        className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.supplierPhone ? 'border-error/60' : 'border-outline-variant/20'}`}
				                        value={newSupplierPhone}
				                        onChange={(e) => {
				                          clearFieldError('supplierPhone');
				                          setNewSupplierPhone(normalizeTenDigitPhoneInput(e.target.value));
				                        }}
				                        placeholder="Phone"
				                        inputMode="numeric"
				                        maxLength={10}
				                        pattern="[0-9]{10}"
				                      />
				                      {fieldErrors.supplierPhone ? <div className="text-xs text-error">{fieldErrors.supplierPhone}</div> : null}
				                    </label>
                          <label className="space-y-1">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mobile 2</div>
                            <input
                              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                              value={newSupplierMobile2}
                              onChange={(e) => setNewSupplierMobile2(normalizeTenDigitPhoneInput(e.target.value))}
                              placeholder="Mobile 2"
                              inputMode="numeric"
                              maxLength={10}
                              pattern="[0-9]{10}"
                            />
                          </label>
                          <label className="space-y-1">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Person</div>
                            <input
                              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                              value={newSupplierContactPerson}
                              onChange={(e) => setNewSupplierContactPerson(e.target.value)}
                              placeholder="Contact person"
                            />
                          </label>
                          <label className="space-y-1">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Person Mobile</div>
                            <input
                              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                              value={newSupplierContactPersonMobile}
                              onChange={(e) => setNewSupplierContactPersonMobile(normalizeTenDigitPhoneInput(e.target.value))}
                              placeholder="Contact person mobile"
                              inputMode="numeric"
                              maxLength={10}
                              pattern="[0-9]{10}"
                            />
                          </label>
		                          <label className="space-y-1">
			                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">State <span className="text-red-600">*</span></div>
		                            <SearchableSelect
		                              value={newSupplierState}
		                              options={states
                                    .slice()
                                    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }))
                                    .map((s) => ({ value: s.name, label: s.name }))}
		                              onChange={(v) => {
		                                setNewSupplierState(v);
		                                setNewSupplierCity('');
	                              }}
	                              placeholder="Select state..."
	                              onCreate={async (label) => {
	                                const name = label.trim();
	                                if (!name) return null;
	                                const created = await createState({ name, createdBy: 'system' });
	                                const next = created.state;
	                                if (!next?.id) return null;
	                                await refreshCurrentTab('states');
	                                setNewSupplierState(next.name);
	                                setNewSupplierCity('');
	                                return { value: next.name, label: next.name };
		                              }}
		                            />
		                          </label>
		                          <label className="space-y-1">
			                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">City <span className="text-red-600">*</span></div>
		                            <SearchableSelect
		                              value={newSupplierCity}
		                              options={cities
		                                .filter((c) => String(c.state ?? '').trim() && String(c.state ?? '').trim() === String(newSupplierState ?? '').trim())
                                    .slice()
                                    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }))
		                                .map((c) => ({ value: c.name, label: c.name }))}
		                              onChange={setNewSupplierCity}
		                              placeholder={newSupplierState.trim() ? 'Select city...' : 'Select state first'}
		                              disabled={!newSupplierState.trim()}
		                              onCreate={async (label) => {
		                                const state = newSupplierState.trim();
		                                const name = label.trim();
		                                if (!state) {
		                                  setError('Please select State first.');
		                                  return null;
		                                }
		                                if (!name) return null;
		                                const created = await createCity({ state, name, createdBy: 'system' });
		                                const next = created.city;
		                                if (!next?.id) return null;
		                                await refreshCurrentTab('cities');
		                                setNewSupplierCity(next.name);
		                                return { value: next.name, label: next.name };
		                              }}
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
                          <label className="space-y-1">
                            <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catalogue Link</div>
                            <input
                              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                              value={newSupplierCatalogueLink}
                              onChange={(e) => setNewSupplierCatalogueLink(e.target.value)}
                              placeholder="https://..."
                            />
                          </label>

			                    <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
			                      <input
			                        type="checkbox"
			                        className="w-4 h-4 rounded border-outline-variant"
			                        checked={newSupplierIsVendor}
			                        onChange={(e) => setNewSupplierIsVendor(e.target.checked)}
			                      />
			                      <span className="font-semibold text-on-surface">Vendor</span>
			                    </label>
			                  </div>
				                  <div className="pt-3 flex justify-end gap-2">
				                    <button
				                      type="button"
			                      className="btn btn-sm"
				                      onClick={() => {
				                        setNewSupplierName('');
				                        setNewSupplierGstNumber('');
				                        setNewSupplierGstType('Intra-State');
				                        setNewSupplierAddress('');
				                        setNewSupplierPhone('');
                                setNewSupplierMobile2('');
                                setNewSupplierContactPerson('');
                                setNewSupplierContactPersonMobile('');
                                setNewSupplierCity('');
                                setNewSupplierState('');
				                        setNewSupplierPaymentTerms('');
				                        setNewSupplierIsVendor(false);
                                setNewSupplierCatalogueLink('');
				                        closeModal();
				                      }}
			                    >
		                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newSupplierName.trim() || !newSupplierCity.trim() || !newSupplierState.trim() || (newSupplierGstNumber.trim() && !newSupplierGstType.trim()) || busy}
				                      onClick={() => {
				                        setBusy(true);
				                        setError(null);
				                        setFieldErrors({});
					                        const phone = newSupplierPhone.trim();
					                        const supplierName = newSupplierName.trim();
					                        const gstType = newSupplierGstType.trim();
                                  const hasGstNumber = Boolean(newSupplierGstNumber.trim());
					                        const city = newSupplierCity.trim();
					                        const state = newSupplierState.trim();
						                        if (!supplierName || (hasGstNumber && !gstType) || !city || !state) {
						                          setBusy(false);
						                          setError('Please fill all required fields: Supplier Name, City, State. GST Type is required when GST is entered.');
						                          return;
						                        }
					                        if (phone && !isValidTenDigitPhone(phone)) {
				                          setBusy(false);
				                          setFieldError('supplierPhone', 'Must be a 10 digit number.');
				                          return;
				                        }
					                        const fn = isEditing
					                          ? updateSupplier(editCtx?.id ?? '', {
						                              name: supplierName,
					                              gstNumber: newSupplierGstNumber.trim() || undefined,
						                              gstType,
                                  creditVoucherApplicable: newSupplierCreditVoucherApplicable,
					                              address: newSupplierAddress.trim() || undefined,
					                              phone: phone || undefined,
                                  mobile2: newSupplierMobile2.trim() || undefined,
                                  contactPerson: newSupplierContactPerson.trim() || undefined,
                                  contactPersonMobile: newSupplierContactPersonMobile.trim() || undefined,
	                                  city,
	                                  state,
				                              paymentTerms: newSupplierPaymentTerms.trim() || undefined,
				                              isVendor: newSupplierIsVendor,
                                  catalogueLink: newSupplierCatalogueLink.trim() || undefined,
				                              updatedBy: 'system',
				                            })
					                          : createSupplier({
						                              name: supplierName,
					                              gstNumber: newSupplierGstNumber.trim() || undefined,
						                              gstType,
                                  creditVoucherApplicable: newSupplierCreditVoucherApplicable,
					                              address: newSupplierAddress.trim() || undefined,
					                              phone: phone || undefined,
                                  mobile2: newSupplierMobile2.trim() || undefined,
                                  contactPerson: newSupplierContactPerson.trim() || undefined,
                                  contactPersonMobile: newSupplierContactPersonMobile.trim() || undefined,
	                                  city,
	                                  state,
				                              paymentTerms: newSupplierPaymentTerms.trim() || undefined,
				                              isVendor: newSupplierIsVendor,
                                  catalogueLink: newSupplierCatalogueLink.trim() || undefined,
				                              createdBy: 'system',
				                            });
			                        fn.then((result: any) => {
                                  const saved = (result as any)?.store as Store | undefined;
                                  if (!saved?.id) return;
                                  setStores((prev) => {
                                    const existingIndex = prev.findIndex((s) => s.id === saved.id);
                                    if (existingIndex >= 0) {
                                      const next = [...prev];
                                      next[existingIndex] = saved;
                                      return next.sort((a, b) => a.name.localeCompare(b.name));
                                    }
                                    return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
                                  });
                                })
			                          .then(() => {
			                            setNewSupplierName('');
			                            setNewSupplierGstNumber('');
			                            setNewSupplierGstType('Intra-State');
				                            setNewSupplierAddress('');
				                            setNewSupplierPhone('');
                                setNewSupplierMobile2('');
                                setNewSupplierContactPerson('');
                                setNewSupplierContactPersonMobile('');
                                setNewSupplierCity('');
                                setNewSupplierState('');
				                            setNewSupplierPaymentTerms('');
				                            setNewSupplierIsVendor(false);
                                setNewSupplierCatalogueLink('');
				                            closeModal();
				                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
		                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
	                </div>
		              ) : null}

		              {tab === 'customers' ? (
		                <div className="space-y-2">
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Customer Name</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newCustomerName}
		                      onChange={(e) => setNewCustomerName(e.target.value)}
		                      placeholder="Customer name"
		                    />
		                  </label>
				                  <div className="grid grid-cols-1 gap-3">
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Category Name</div>
				                      <input className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none" value={newCustomerCategoryName} onChange={(e) => setNewCustomerCategoryName(e.target.value)} placeholder="Category name" />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Sub-Category Name</div>
				                      <input className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none" value={newCustomerSubCategoryName} onChange={(e) => setNewCustomerSubCategoryName(e.target.value)} placeholder="Sub-category name" />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">City</div>
				                      <SearchableSelect
				                        value={newCustomerCity}
				                        options={cities.map((c) => ({ value: c.name, label: c.name }))}
				                        onChange={setNewCustomerCity}
				                        placeholder="Select city..."
				                      />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">State</div>
				                      <SearchableSelect
				                        value={newCustomerState}
				                        options={states.map((s) => ({ value: s.name, label: s.name }))}
				                        onChange={setNewCustomerState}
				                        placeholder="Select state..."
				                      />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Person</div>
				                      <input className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none" value={newCustomerContactPerson} onChange={(e) => setNewCustomerContactPerson(e.target.value)} placeholder="Contact person" />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Contact Number</div>
				                      <input className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.customerContactNumber ? 'border-error/60' : 'border-outline-variant/20'}`} value={newCustomerContactNumber} onChange={(e) => { clearFieldError('customerContactNumber'); setNewCustomerContactNumber(normalizeTenDigitPhoneInput(e.target.value)); }} placeholder="Contact number" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" />
				                      {fieldErrors.customerContactNumber ? <div className="text-xs text-error">{fieldErrors.customerContactNumber}</div> : null}
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Email ID</div>
				                      <input className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none" value={newCustomerEmailId} onChange={(e) => setNewCustomerEmailId(e.target.value)} placeholder="Email ID" type="email" />
				                    </label>
				                    <label className="space-y-1">
				                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Customer Mobile</div>
			                      <input
			                        className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.customerMobile ? 'border-error/60' : 'border-outline-variant/20'}`}
			                        value={newCustomerMobile}
			                        onChange={(e) => {
			                          clearFieldError('customerMobile');
			                          setNewCustomerMobile(normalizeTenDigitPhoneInput(e.target.value));
			                        }}
			                        placeholder="Mobile"
			                        inputMode="numeric"
			                        maxLength={10}
			                        pattern="[0-9]{10}"
			                      />
			                      {fieldErrors.customerMobile ? <div className="text-xs text-error">{fieldErrors.customerMobile}</div> : null}
			                    </label>
<label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Customer Address</div>
		                      <textarea
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none min-h-[80px]"
		                        value={newCustomerAddress}
		                        onChange={(e) => setNewCustomerAddress(e.target.value)}
		                        placeholder="Address"
		                      />
		                    </label>
		                  </div>
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button type="button" className="btn btn-sm" onClick={closeModal}>
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newCustomerName.trim() || busy}
				                      onClick={() => {
				                        setBusy(true);
				                        setError(null);
				                        setFieldErrors({});
					                        const phone = newCustomerMobile.trim();
					                        if (phone && !isValidTenDigitPhone(phone)) {
				                          setBusy(false);
				                          setFieldError('customerMobile', 'Must be a 10 digit number.');
				                          return;
				                        }
					                        const contactNumber = newCustomerContactNumber.trim();
					                        if (contactNumber && !isValidTenDigitPhone(contactNumber)) {
					                          setBusy(false);
					                          setFieldError('customerContactNumber', 'Must be a 10 digit number.');
					                          return;
					                        }
					                        const fn = isEditing
				                          ? updateCustomer(editCtx?.id ?? '', {
				                              name: newCustomerName.trim(),
				                              phone: phone || undefined,
				                              address: newCustomerAddress.trim() || undefined,
				                              categoryName: newCustomerCategoryName.trim() || undefined,
				                              subCategoryName: newCustomerSubCategoryName.trim() || undefined,
				                              city: newCustomerCity.trim() || undefined,
				                              state: newCustomerState.trim() || undefined,
				                              contactPerson: newCustomerContactPerson.trim() || undefined,
				                              contactNumber: contactNumber || undefined,
				                              emailId: newCustomerEmailId.trim() || undefined,
				                              updatedBy: 'system',
				                            })
				                          : createCustomer({
				                              name: newCustomerName.trim(),
				                              phone: phone || undefined,
				                              address: newCustomerAddress.trim() || undefined,
				                              categoryName: newCustomerCategoryName.trim() || undefined,
				                              subCategoryName: newCustomerSubCategoryName.trim() || undefined,
				                              city: newCustomerCity.trim() || undefined,
				                              state: newCustomerState.trim() || undefined,
				                              contactPerson: newCustomerContactPerson.trim() || undefined,
				                              contactNumber: contactNumber || undefined,
				                              emailId: newCustomerEmailId.trim() || undefined,
				                              createdBy: 'system',
				                            });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
			                            setNewCustomerName('');
			                            setNewCustomerMobile('');
			                            setNewCustomerAddress('');
			                            setNewCustomerCategoryName('');
			                            setNewCustomerSubCategoryName('');
			                            setNewCustomerCity('');
			                            setNewCustomerState('');
			                            setNewCustomerContactPerson('');
			                            setNewCustomerContactNumber('');
			                            setNewCustomerEmailId('');
			                            closeModal();
		                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
		                      }}
		                    >
		                      {isEditing ? 'Save' : 'Add'}
		                    </button>
		                  </div>
		                </div>
		              ) : null}

			              {tab === 'transporters' ? (
			                <div className="space-y-2">
		                  <label className="space-y-1">
	                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transporter name</div>
	                    <input
	                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                      value={newTransporterName}
	                      onChange={(e) => setNewTransporterName(e.target.value)}
	                      placeholder="DTDC"
	                    />
	                  </label>
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Phone (optional)</div>
		                    <input
		                      className={`w-full bg-surface-container-low border rounded-lg px-3 py-2 text-sm outline-none ${fieldErrors.transporterPhone ? 'border-error/60' : 'border-outline-variant/20'}`}
		                      value={newTransporterPhone}
		                      onChange={(e) => {
		                        clearFieldError('transporterPhone');
		                        setNewTransporterPhone(normalizeTenDigitPhoneInput(e.target.value));
		                      }}
		                      placeholder="9876543210"
		                      inputMode="numeric"
		                      maxLength={10}
		                      pattern="[0-9]{10}"
		                    />
		                    {fieldErrors.transporterPhone ? <div className="text-xs text-error">{fieldErrors.transporterPhone}</div> : null}
		                  </label>
	                  <div className="pt-3 flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="btn btn-sm"
	                      onClick={() => {
	                        setNewTransporterName('');
	                        setNewTransporterPhone('');
	                        closeModal();
	                      }}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      type="button"
	                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
	                      disabled={!newTransporterName.trim() || busy}
			                      onClick={() => {
			                        setBusy(true);
			                        setError(null);
			                        setFieldErrors({});
			                        const phone = newTransporterPhone.trim();
			                        if (phone && !isValidTenDigitPhone(phone)) {
			                          setBusy(false);
			                          setFieldError('transporterPhone', 'Must be a 10 digit number.');
			                          return;
			                        }
			                        const fn = isEditing
		                          ? updateTransporter(editCtx?.id ?? '', {
		                              name: newTransporterName.trim(),
		                              phone: phone || null,
		                              updatedBy: 'system',
		                            })
		                          : createTransporter({
		                              name: newTransporterName.trim(),
		                              phone: phone || undefined,
		                              createdBy: 'system',
		                            });
	                        fn.then(() => refreshCurrentTab(tab))
	                          .then(() => {
	                            setNewTransporterName('');
	                            setNewTransporterPhone('');
	                            closeModal();
	                          })
	                          .catch(handleMasterError)
	                          .finally(() => setBusy(false));
	                      }}
	                    >
	                      {isEditing ? 'Save' : 'Add'}
	                    </button>
	                  </div>
		                </div>
		              ) : null}

				      {tab === 'units' ? (
		                <div className="space-y-2">
		                  <label className="space-y-1">
		                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newUnitName}
		                      onChange={(e) => setNewUnitName(e.target.value)}
		                      placeholder="Nos / Kg / Meter"
		                    />
		                  </label>
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="btn btn-sm"
		                      onClick={() => {
		                        setNewUnitName('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newUnitName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
		                        const fn = isEditing
		                          ? updateUnit(editCtx?.id ?? '', { name: newUnitName.trim(), updatedBy: 'system' })
		                          : createUnit({ name: newUnitName.trim(), createdBy: 'system' });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewUnitName('');
		                            closeModal();
		                          })
		                          .catch(handleMasterError)
		                          .finally(() => setBusy(false));
		                      }}
		                    >
		                      {isEditing ? 'Save' : 'Add'}
		                    </button>
		                  </div>
		                </div>
			              ) : null}

                    {tab === 'priorities' ? (
                      <div className="space-y-2">
                        <label className="space-y-1">
                          <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Priority</div>
                          <input
                            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                            value={newPriorityName}
                            onChange={(e) => setNewPriorityName(e.target.value)}
                            placeholder="High / Medium / Low"
                          />
                        </label>
                        <div className="pt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setNewPriorityName('');
                              closeModal();
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
                            disabled={!newPriorityName.trim() || busy}
                            onClick={() => {
                              setBusy(true);
                              setError(null);
                              const fn = isEditing
                                ? updatePriority(editCtx?.id ?? '', { name: newPriorityName.trim(), updatedBy: 'system' })
                                : createPriority({ name: newPriorityName.trim(), createdBy: 'system' });
                              fn.then(() => refreshCurrentTab(tab))
                                .then(() => {
                                  setNewPriorityName('');
                                  closeModal();
                                })
                                .catch(handleMasterError)
                                .finally(() => setBusy(false));
                            }}
                          >
                            {isEditing ? 'Save' : 'Add'}
                          </button>
                        </div>
                      </div>
				      ) : null}

					      {tab === 'itemCategories' ? (
			                <div className="space-y-2">
			                  <label className="space-y-1">
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Category</div>
		                    <input
		                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
		                      value={newItemCategoryName}
		                      onChange={(e) => setNewItemCategoryName(e.target.value)}
		                      placeholder="Hardware"
		                    />
		                  </label>
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="btn btn-sm"
		                      onClick={() => {
		                        setNewItemCategoryName('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
		                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
		                      disabled={!newItemCategoryName.trim() || busy}
		                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
		                        const fn = isEditing
		                          ? updateItemCategory(editCtx?.id ?? '', { name: newItemCategoryName.trim(), updatedBy: 'system' })
		                          : createItemCategory({ name: newItemCategoryName.trim(), createdBy: 'system' });
		                        fn.then(() => refreshCurrentTab(tab))
		                          .then(() => {
		                            setNewItemCategoryName('');
		                            closeModal();
		                          })
		                          .catch(handleMasterError)
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
                        <label className="space-y-1">
                          <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Type</div>
	                          <select
	                            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                            value={newItemNameType}
	                            onChange={(e) => {
	                              const nextType = String(e.target.value) === 'Services' ? 'Services' : 'Goods';
	                              setNewItemNameType(nextType);
	                              if (nextType === 'Services') setNewItemNameSpecIds([]);
	                            }}
	                          >
	                            <option value="Goods">Goods</option>
	                            <option value="Services">Services</option>
	                          </select>
	                        </label>
						                  <label className="space-y-1">
						                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Category</div>
						                    <SearchableSelect
					                      options={itemCategories.map((c) => ({ value: c.id, label: c.name }))}
				                      value={newItemNameCategoryId}
				                      onChange={(v) => {
				                        clearFieldError('itemNameCategoryId');
				                        setNewItemNameCategoryId(v);
				                      }}
				                      placeholder="Select category"
                              showCreateWhenEmpty
                              allowEmptyCreate
                              closeOnCreate
                              createLabel={(q) => (q?.trim() ? `+ Add Category "${q.trim()}"` : '+ Add Category')}
                              onCreate={async (label) => {
                                const name = String(label ?? '').trim();
                                if (!name) return null;
                                const created = await createItemCategory({ name, createdBy: 'system' });
                                const cat = created.itemCategory;
                                if (!cat?.id) return null;
                                setItemCategories((prev) => {
                                  if (prev.some((x) => x.id === cat.id)) return prev;
                                  return [...prev, cat].sort((a, b) => a.name.localeCompare(b.name));
                                });
                                setNewItemNameCategoryId(cat.id);
                                return { value: cat.id, label: cat.name };
                              }}
				                    />
					                    {fieldErrors.itemNameCategoryId ? <div className="text-xs text-error">{fieldErrors.itemNameCategoryId}</div> : null}
					                  </label>
				                  <label className="space-y-1">
				                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
				                    <SearchableSelect
				                      options={units.map((u) => ({ value: u.id, label: u.name }))}
				                      value={newItemNameUnitId}
				                      onChange={(v) => {
				                        clearFieldError('itemNameUnitId');
				                        setNewItemNameUnitId(v);
				                      }}
				                      placeholder="Select unit"
                              showCreateWhenEmpty
                              allowEmptyCreate
                              closeOnCreate
                              createLabel={(q) => (q?.trim() ? `+ Add Unit "${q.trim()}"` : '+ Add Unit')}
                              onCreate={async (label) => {
                                const name = String(label ?? '').trim();
                                if (!name) return null;
                                const created = await createUnit({ name, createdBy: 'system' });
                                const unit = created.unit;
                                if (!unit?.id) return null;
                                setUnits((prev) => {
                                  if (prev.some((x) => x.id === unit.id)) return prev;
                                  return [...prev, unit].sort((a, b) => a.name.localeCompare(b.name));
                                });
                                setNewItemNameUnitId(unit.id);
                                return { value: unit.id, label: unit.name };
                              }}
				                    />
				                    {fieldErrors.itemNameUnitId ? <div className="text-xs text-error">{fieldErrors.itemNameUnitId}</div> : null}
				                  </label>

				                  {newItemNameType !== 'Services' ? <div className="space-y-1">
				                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specifications</div>
				                    <div className="space-y-2">
				                      {newItemNameSpecIds.map((specId, idx) => (
				                        <div key={`iname-spec-${idx}`} className="flex items-center gap-2">
				                          <div className="flex-1">
				                            <SearchableSelect
				                              value={specId}
				                              options={specs.map((s) => ({ value: s.id, label: s.name }))}
				                              onChange={(v) =>
				                                setNewItemNameSpecIds((prev) => prev.map((p, i) => (i === idx ? v : p)).filter(Boolean))
				                              }
				                              placeholder="Select specification"
				                              showCreateWhenEmpty
				                              allowEmptyCreate
				                              closeOnCreate
				                              createLabel={(q) => (q ? `+ Create Specification \"${q}\"` : '+ Create Specification')}
				                              onCreate={async (label) => {
				                                const name = String(label ?? '').trim();
				                                if (!name) return null;
				                                const created = await createSpecification({ name, createdBy: 'system' });
				                                const spec = created.specification;
				                                if (!spec?.id) return null;
				                                setSpecs((prev) => {
				                                  if (prev.some((s) => s.id === spec.id)) return prev;
				                                  return [...prev, spec].sort((a, b) => a.name.localeCompare(b.name));
				                                });
				                                setNewItemNameSpecIds((prev) => prev.map((p, i) => (i === idx ? spec.id : p)));
				                                return null;
				                              }}
				                            />
				                          </div>
				                          <button
				                            type="button"
				                            className="btn btn-sm"
				                            onClick={() => setNewItemNameSpecIds((prev) => prev.filter((_, i) => i !== idx))}
				                          >
				                            Remove
				                          </button>
				                        </div>
				                      ))}
				                      <button
				                        type="button"
				                        className="btn btn-sm"
				                        onClick={() => setNewItemNameSpecIds((prev) => [...prev, ''])}
				                      >
				                        + Add Specification
				                      </button>
				                    </div>
				                  </div> : null}
                      <label className="space-y-1">
                        <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catalogue Link</div>
                        <input
                          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                          value={newItemNameCatalogueLink}
                          onChange={(e) => setNewItemNameCatalogueLink(e.target.value)}
                          placeholder="https://..."
                        />
                      </label>
			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
			                      className="btn btn-sm"
			                      onClick={() => {
			                        setNewItemName('');
			                        setNewItemNameUnitId('');
			                        setNewItemNameCategoryId('');
                          setNewItemNameCatalogueLink('');
		                        closeModal();
		                      }}
		                    >
		                      Cancel
	                    </button>
		                    <button
		                      type="button"
		                      className="px-4 py-2 text-xs font-semibold text-on-primary bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
			                      disabled={!newItemName.trim() || !newItemNameUnitId || !newItemNameCategoryId || busy}
				                      onClick={() => {
				                        setBusy(true);
				                        setError(null);
				                        setFieldErrors({});
				                        if (!newItemNameUnitId) {
				                          setBusy(false);
				                          setFieldError('itemNameUnitId', 'Unit is required.');
				                          return;
				                        }
				                        if (!newItemNameCategoryId) {
				                          setBusy(false);
				                          setFieldError('itemNameCategoryId', 'Category is required.');
				                          return;
				                        }
					                        const fn = isEditing
					                          ? updateItemName(editCtx?.id ?? '', {
					                              name: newItemName.trim(),
                                type: newItemNameType,
					                              unitId: newItemNameUnitId || null,
				                              itemCategoryId: newItemNameCategoryId || null,
				                              specificationIds: newItemNameSpecIds.filter(Boolean),
	                                catalogueLink: newItemNameCatalogueLink.trim() || null,
					                              updatedBy: 'system',
					                            })
					                          : createItemName({
					                              name: newItemName.trim(),
                                type: newItemNameType,
					                              unitId: newItemNameUnitId || null,
					                              itemCategoryId: newItemNameCategoryId || null,
					                              specificationIds: newItemNameSpecIds.filter(Boolean),
	                                catalogueLink: newItemNameCatalogueLink.trim() || null,
					                              createdBy: 'system',
					                            });
		                        fn.then(() => refreshCurrentTab(tab))
			                          .then(() => {
				                            setNewItemName('');
                                setNewItemNameType('Goods');
				                            setNewItemNameUnitId('');
				                            setNewItemNameCategoryId('');
				                            setNewItemNameSpecIds([]);
	                              setNewItemNameCatalogueLink('');
				                            closeModal();
			                          })
		                          .catch(handleMasterError)
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
		                  <div className="pt-3 flex justify-end gap-2">
		                    <button
		                      type="button"
		                      className="btn btn-sm"
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
	                        fn.then(() => refreshCurrentTab(tab))
	                          .then(() => {
	                            setNewSpecName('');
	                            closeModal();
	                          })
	                          .catch(handleMasterError)
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
			                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Name</div>
			                    <SearchableSelect
			                      value={specValueItemNameId}
			                      options={itemNames.map((n) => ({ value: n.id, label: n.name }))}
			                      onChange={setSpecValueItemNameId}
			                      placeholder="Select item name..."
			                    />
			                  </label>
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
			                  <div className="pt-3 flex justify-end gap-2">
			                    <button
			                      type="button"
		                      className="btn btn-sm"
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
				                      disabled={!specValueItemNameId || !newSpecValueSpecId || !newSpecValue.trim() || busy}
				                      onClick={() => {
				                        setBusy(true);
				                        setError(null);
				                        const fn = isEditing
				                          ? updateSpecificationValue(editCtx?.id ?? '', {
				                              specificationId: newSpecValueSpecId,
				                              itemNameId: specValueItemNameId,
				                              value: newSpecValue.trim(),
				                              updatedBy: 'system',
				                            })
				                          : createSpecificationValue({
				                              specificationId: newSpecValueSpecId,
				                              itemNameId: specValueItemNameId,
				                              value: newSpecValue.trim(),
				                              createdBy: 'system',
				                            });
				                        fn
				                          .then(() => fetchSpecificationValues(newSpecValueSpecId, { itemNameId: specValueItemNameId }))
				                          .then((vals) => {
				                            setSpecValueOptions((m) => ({ ...m, [newSpecValueSpecId]: vals }));
				                          })
			                          .then(async () => {
			                            if (specIdForValues) {
			                              const rows = await fetchSpecificationValues(specIdForValues, { itemNameId: specValueItemNameId || undefined });
			                              setSpecValues(rows);
			                              return;
			                            }
			                            const all = await Promise.all(
			                              specs.map((s) => fetchSpecificationValues(s.id, { itemNameId: specValueItemNameId || undefined }))
			                            );
			                            const flat = all
			                              .flat()
			                              .sort((a, b) => {
			                                const an = specNameLookup[a.specificationId] ?? '';
		                                const bn = specNameLookup[b.specificationId] ?? '';
		                                if (an !== bn) return an.localeCompare(bn);
		                                return a.value.localeCompare(b.value);
		                              });
		                            setSpecValues(flat);
			                          })
			                          .then(() => {
			                            setNewSpecValue('');
			                            closeModal();
	                          })
	                          .catch(handleMasterError)
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
				                        onChange={(itemNameId) => {
                                      setNewItemItemNameId(itemNameId);
                                      if (!itemNameId || inlineCreatedItemNameIds.includes(itemNameId)) return;
                                      const selected = itemNames.find((n) => n.id === itemNameId);
                                      const mappedSpecIds = Array.isArray((selected as any)?.specificationIds)
                                        ? ((selected as any).specificationIds as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)
                                        : [];
                                      setNewItemSpecs(
                                        mappedSpecIds.length
                                          ? mappedSpecIds.map((specId) => ({ specificationId: specId, value: '', useCustom: false }))
                                          : [{ specificationId: '', value: '', useCustom: false }]
                                      );
                                      mappedSpecIds.forEach((specId) => {
                                        fetchSpecificationValues(specId, { itemNameId })
                                          .then((vals) => setSpecValueOptions((m) => ({ ...m, [specId]: vals })))
                                          .catch(() => {});
                                      });
                                    }}
				                        placeholder="Search item name..."
                                  alwaysShowCreate
                                  showCreateWhenEmpty
                                  allowEmptyCreate
                                  closeOnCreate
                                  createLabel={(query) => (query ? `+ Add Item Name "${query}"` : '+ Add New Item Name')}
			                        onCreate={async (label) => {
			                          const name = String(label ?? '').trim();
                                    setInlineItemNameError(null);
                                    setInlineItemNameName(name);
                                    setInlineItemNameUnitId('');
                                    setInlineItemNameCategoryId('');
                                    setInlineItemNameOpen(true);
			                          return null;
			                        }}
			                      />
			                    </label>
                          {inlineItemNameOpen ? (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                              <button
                                type="button"
                                className="absolute inset-0 bg-black/40"
                                aria-label="Close"
                                onClick={() => {
                                  setInlineItemNameOpen(false);
                                  setInlineItemNameError(null);
                                }}
                              />
                              <div className="relative w-full max-w-xl bg-surface-container-lowest border border-outline-variant shadow-xl rounded-2xl overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant bg-surface-container-lowest">
                                  <div className="text-sm font-bold text-on-surface">Create new Item Name</div>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setInlineItemNameOpen(false);
                                      setInlineItemNameError(null);
                                    }}
                                  >
                                    Close
                                  </button>
                                </div>

                                <div className="p-5 space-y-3">
                                  {inlineItemNameError ? <div className="text-xs text-error">{inlineItemNameError}</div> : null}
                                  <label className="space-y-1">
                                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Name</div>
                                    <input
                                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                                      value={inlineItemNameName}
                                      onChange={(e) => setInlineItemNameName(e.target.value)}
                                      placeholder="Laptop"
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
                                    <SearchableSelect
                                      value={inlineItemNameUnitId}
                                      options={units.map((u) => ({ value: u.id, label: u.name }))}
                                      onChange={setInlineItemNameUnitId}
                                      placeholder="Select unit..."
                                      showCreateWhenEmpty
                                      allowEmptyCreate
                                      closeOnCreate
                                      createLabel={(q) => (q.trim() ? `+ Add Unit "${q.trim()}"` : '+ Add Unit')}
                                      onCreate={async (label) => {
                                        setInlineUnitCreateError(null);
                                        setInlineUnitCreateName(String(label ?? '').trim());
                                        setInlineUnitCreateOpen(true);
                                        return null;
                                      }}
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Category</div>
                                    <SearchableSelect
                                      value={inlineItemNameCategoryId}
                                      options={itemCategories.map((c) => ({ value: c.id, label: c.name }))}
                                      onChange={setInlineItemNameCategoryId}
                                      placeholder="Select category..."
                                      showCreateWhenEmpty
                                      allowEmptyCreate
                                      closeOnCreate
                                      createLabel={(q) => (q.trim() ? `+ Add Category "${q.trim()}"` : '+ Add Category')}
                                      onCreate={async (label) => {
                                        setInlineCategoryCreateError(null);
                                        setInlineCategoryCreateName(String(label ?? '').trim());
                                        setInlineCategoryCreateOpen(true);
                                        return null;
                                      }}
                                    />
                                  </label>
                                </div>

                                <div className="px-5 py-4 border-t border-outline-variant flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setInlineItemNameOpen(false);
                                      setInlineItemNameError(null);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy || !inlineItemNameName.trim() || !inlineItemNameUnitId || !inlineItemNameCategoryId}
                                    onClick={() => {
                                      const name = inlineItemNameName.trim();
                                      if (!name) return setInlineItemNameError('name is required');
                                      if (!inlineItemNameUnitId) return setInlineItemNameError('unitId is required');
                                      if (!inlineItemNameCategoryId) return setInlineItemNameError('itemCategoryId is required');
                                      setBusy(true);
                                      setInlineItemNameError(null);
                                      createItemName({
                                        name,
                                        unitId: inlineItemNameUnitId,
                                        itemCategoryId: inlineItemNameCategoryId,
                                        createdBy: 'system',
                                      })
                                        .then(async (created) => {
                                          const next = created.itemName;
                                          await loadAll();
	                                          if (next?.id) {
                                              setInlineCreatedItemNameIds((prev) => (prev.includes(next.id) ? prev : [...prev, next.id]));
                                              setNewItemItemNameId(next.id);
                                            }
                                          setInlineItemNameOpen(false);
                                        })
                                        .catch((e) => setInlineItemNameError(e instanceof Error ? e.message : String(e)))
                                        .finally(() => setBusy(false));
                                    }}
                                  >
                                    Create
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          <InlineCreateDialog
                            open={inlineUnitCreateOpen}
                            title="Add Unit"
                            value={inlineUnitCreateName}
                            setValue={setInlineUnitCreateName}
                            error={inlineUnitCreateError}
                            busy={inlineUnitCreateBusy}
                            placeholder="Enter unit name"
                            onClose={closeInlineUnitCreate}
                            onSubmit={submitInlineUnitCreate}
                          />

                          <InlineCreateDialog
                            open={inlineCategoryCreateOpen}
                            title="Add Item Category"
                            value={inlineCategoryCreateName}
                            setValue={setInlineCategoryCreateName}
                            error={inlineCategoryCreateError}
                            busy={inlineCategoryCreateBusy}
                            placeholder="Enter category name"
                            onClose={closeInlineCategoryCreate}
                            onSubmit={submitInlineCategoryCreate}
                          />
		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Unit</div>
		                      <input
		                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none opacity-80"
		                        value={newItemUnit}
		                        readOnly
		                        disabled
	                        placeholder="Select item name first"
	                      />
	                    </label>
		                  </div>
	
				                  {newItemItemNameId ? (
                              <div className="space-y-2">
				                    <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Specifications</div>
                            <div className="rounded-lg border border-outline-variant/15 overflow-hidden">
                              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 bg-surface-container-low text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                                <div>Specification</div>
                                <div>Value</div>
                                <div>Action</div>
                              </div>
                              <div className="p-2 space-y-2">
                                {newItemSpecs.map((row, idx) => (
                                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                                    <div>
                                      {Boolean(newItemItemNameId) && !inlineCreatedItemNameIds.includes(newItemItemNameId) ? (
                                        <input
                                          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none opacity-80"
                                          value={specNameLookup[row.specificationId] ?? ''}
                                          readOnly
                                          disabled
                                        />
                                      ) : (
                                        <SearchableSelect
                                          value={row.specificationId}
                                          options={specs.map((s) => ({ value: s.id, label: s.name }))}
                                          onChange={(specId) => {
                                            setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, specificationId: specId, value: '', useCustom: false } : p)));
                                            if (!specId) return;
                                            fetchSpecificationValues(specId).then((vals) => setSpecValueOptions((m) => ({ ...m, [specId]: vals }))).catch(() => {});
                                          }}
                                          placeholder="Select specification..."
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
                                      )}
                                    </div>
                                    <div>
                                      <SearchableSelect
                                        value={row.value}
                                        options={(() => {
                                          const opts = (specValueOptions[row.specificationId] ?? []).map((v) => ({ value: v.value, label: v.value }));
                                          if (row.value && !opts.some((o) => o.value === row.value)) return [{ value: row.value, label: row.value }, ...opts];
                                          return opts;
                                        })()}
                                        onChange={(v) => setNewItemSpecs((prev) => prev.map((p, i) => (i === idx ? { ...p, value: v } : p)))}
                                        disabled={!row.specificationId}
                                        placeholder={row.specificationId ? 'Select or type value...' : 'Select spec first'}
                                        createLabel={(q) => `+ Add Value "${q}"`}
                                        onCreate={async (label) => {
                                          const v = label.trim();
                                          if (!v || !row.specificationId) return null;
                                          try {
                                            const created = await createSpecificationValue({ specificationId: row.specificationId, value: v, createdBy: 'system' });
                                            const next = created.specificationValue;
                                            if (next) {
                                              setSpecValueOptions((m) => {
                                                const prev = m[row.specificationId] ?? [];
                                                if (prev.some((p) => p.value === next.value)) return m;
                                                return { ...m, [row.specificationId]: [...prev, next] };
                                              });
                                              return { value: next.value, label: next.value };
                                            }
                                          } catch {}
                                          setSpecValueOptions((m) => {
                                            const prev = m[row.specificationId] ?? [];
                                            if (prev.some((p) => p.value === v)) return m;
                                            return { ...m, [row.specificationId]: [...prev, { id: `NEW-${Date.now()}-${Math.random()}`, specificationId: row.specificationId, value: v, isActive: true }] };
                                          });
                                          return { value: v, label: v };
                                        }}
                                      />
                                    </div>
                                    <div>
                                      {!(Boolean(newItemItemNameId) && !inlineCreatedItemNameIds.includes(newItemItemNameId)) ? (
                                        <button
                                          type="button"
                                          className="btn btn-sm disabled:opacity-50"
                                          disabled={newItemSpecs.length === 1}
                                          onClick={() => setNewItemSpecs((prev) => prev.filter((_, i) => i !== idx))}
                                          title={newItemSpecs.length === 1 ? 'At least one specification required' : 'Remove'}
                                        >
                                          Remove
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {!(Boolean(newItemItemNameId) && !inlineCreatedItemNameIds.includes(newItemItemNameId)) ? (
			                      <button
			                        type="button"
			                        className="btn btn-sm"
			                        onClick={() => setNewItemSpecs((prev) => [...prev, { specificationId: '', value: '', useCustom: false }])}
			                      >
			                        + Add Spec Row
			                      </button>
                            ) : null}
				                  </div>
                              ) : (
                                <div className="text-xs text-on-surface-variant bg-surface-container-low border border-outline-variant/15 rounded-lg px-3 py-2">
                                  Select Item Name to add specifications.
                                </div>
                              )}

		                    <label className="space-y-1">
		                      <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Re-Order Level (optional)</div>
		                      <input
		                        type="number"
		                        min="0"
	                        className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                        value={newItemReorderLevel}
	                        onChange={(e) => setNewItemReorderLevel(e.target.value)}
		                        placeholder="0.00"
		                      />
		                    </label>
                      <div className="space-y-2">
                        {newItemPhotos.map((value, idx) => {
                          const canShow = idx === 0 || Boolean(String(newItemPhotos[idx - 1] ?? '').trim());
                          if (!canShow) return null;
                          return (
                            <label key={`photo-${idx}`} className="space-y-1">
                              <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{`Photo ${idx + 1}`}</div>
                              <div className="flex flex-col gap-2">
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  className="block w-full text-sm text-on-surface file:mr-3 file:rounded-md file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-black/90"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const maxBytes = 2 * 1024 * 1024;
                                    if (file.size > maxBytes) {
                                      setError(`Photo ${idx + 1} is too large. Please upload under 2MB.`);
                                      return;
                                    }
                                    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
                                      setError(`Photo ${idx + 1} must be PNG or JPG.`);
                                      return;
                                    }
                                    const reader = new FileReader();
                                    reader.onload = () =>
                                      setNewItemPhotos((prev) => {
                                        const next = [...prev];
                                        next[idx] = String(reader.result ?? '');
                                        return next;
                                      });
                                    reader.onerror = () => setError(`Failed to read Photo ${idx + 1}.`);
                                    reader.readAsDataURL(file);
                                  }}
                                />
                                <input
                                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                                  value={value}
                                  onChange={(e) =>
                                    setNewItemPhotos((prev) => {
                                      const next = [...prev];
                                      next[idx] = e.target.value;
                                      return next;
                                    })
                                  }
                                  placeholder={`Paste Photo ${idx + 1} URL or data:image/...`}
                                />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <label className="space-y-1">
                        <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Item Link (optional)</div>
                        <input
                          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                          value={newItemLink}
                          onChange={(e) => setNewItemLink(e.target.value)}
                          placeholder="https://..."
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Video Link (optional)</div>
                        <input
                          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                          value={newItemVideoLink}
                          onChange={(e) => setNewItemVideoLink(e.target.value)}
                          placeholder="https://..."
                        />
                      </label>
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Opening Stock (Store-wise)</div>
                        <div className="overflow-auto border border-outline-variant/20 rounded-lg">
                          <table className="min-w-[420px] w-full text-sm border-collapse">
                            <thead>
                              <tr className="bg-surface-container-low">
                                <th className="text-left px-3 py-2 border-b border-outline-variant/20">Store</th>
                                <th className="text-left px-3 py-2 border-b border-outline-variant/20">Opening Balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {newItemStoreOpeningBalances.map((row, idx) => (
                                <tr key={`store-opening-${row.storeId}`}>
                                  <td className="px-3 py-2 border-b border-outline-variant/10 text-on-surface-variant">{row.storeName}</td>
                                  <td className="px-3 py-2 border-b border-outline-variant/10">
                                    <input
                                      type="number"
                                      min="0"
                                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
                                      value={row.quantity}
                                      onChange={(e) =>
                                        setNewItemStoreOpeningBalances((prev) =>
                                          prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p))
                                        )
                                      }
                                      placeholder="0.00"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

			                  <div className="pt-3 flex justify-end gap-2">
	                    <button
	                      type="button"
	                      className="btn btn-sm"
	                      onClick={() => {
		                        setNewItemUnit('');
			                        setNewItemDescription('');
                            setNewItemPhotos(['', '', '', '', '']);
		                            setNewItemLink('');
		                            setNewItemVideoLink('');
		                            setNewItemReorderLevel('');
		                            setNewItemOpeningStock('');
                                setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
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
                        !newItemUnit ||
                        newItemSpecs.filter((s) => s.specificationId.trim() && s.value.trim()).length === 0
                      }
	                      onClick={() => {
		                        setBusy(true);
		                        setError(null);
                          const storeOpeningBalancesPayload = newItemStoreOpeningBalances
                            .map((row) => ({
                              storeName: row.storeName,
                              quantity: Number(row.quantity),
                            }))
                            .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0);
                          const totalOpeningStock = storeOpeningBalancesPayload.reduce((sum, row) => sum + row.quantity, 0);
		                        const fn = isEditing
		                          ? updateItem(editCtx?.id ?? '', {
		                              itemNameId: newItemItemNameId,
		                              unit: newItemUnit,
		                              description: newItemDescription,
                              photo1: String(newItemPhotos[0] ?? '').trim() || null,
                              photo2: String(newItemPhotos[1] ?? '').trim() || null,
                              photo3: String(newItemPhotos[2] ?? '').trim() || null,
                              photo4: String(newItemPhotos[3] ?? '').trim() || null,
                              photo5: String(newItemPhotos[4] ?? '').trim() || null,
		                              itemLink: newItemLink.trim() || null,
		                              videoLink: newItemVideoLink.trim() || null,
		                              reorderLevel: newItemReorderLevel.trim() ? Number(newItemReorderLevel) : null,
                                openingStock: totalOpeningStock,
                                storeOpeningBalances: storeOpeningBalancesPayload,
				                              specs: newItemSpecs,
		                              updatedBy: 'system',
		                            })
		                          : createItem({
	                              itemNameId: newItemItemNameId,
		                              unit: newItemUnit,
		                              description: newItemDescription,
                              photo1: String(newItemPhotos[0] ?? '').trim() || null,
                              photo2: String(newItemPhotos[1] ?? '').trim() || null,
                              photo3: String(newItemPhotos[2] ?? '').trim() || null,
                              photo4: String(newItemPhotos[3] ?? '').trim() || null,
                              photo5: String(newItemPhotos[4] ?? '').trim() || null,
		                              itemLink: newItemLink.trim() || null,
		                              videoLink: newItemVideoLink.trim() || null,
		                              reorderLevel: newItemReorderLevel.trim() ? Number(newItemReorderLevel) : null,
                                openingStock: totalOpeningStock,
                                storeOpeningBalances: storeOpeningBalancesPayload,
				                              specs: newItemSpecs,
		                              createdBy: 'system',
		                            });
	                        fn
	                          .then(() => fetchItems().then(setItems))
	                          .then(() => {
			                            setNewItemUnit('');
			                            setNewItemDescription('');
                                setNewItemPhotos(['', '', '', '', '']);
		                                setNewItemLink('');
		                                setNewItemVideoLink('');
		                                setNewItemReorderLevel('');
	                                  setNewItemOpeningStock('');
                                  setNewItemStoreOpeningBalances(buildDefaultStoreOpeningRows());
					                            setNewItemSpecs([{ specificationId: '', value: '', useCustom: false }]);
			                            closeModal();
	                          })
	                          .catch(handleMasterError)
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
					          <div className="flex flex-wrap items-center justify-between gap-2">
					            <div className="flex flex-wrap items-center gap-2">
					              <div className="text-sm text-on-surface-variant">Showing: {filteredFirms.length} / {firms.length}</div>
					              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
					              <input
					                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
					                value={listQuery}
					                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
		            <button
		              type="button"
		              className="btn btn-primary disabled:opacity-50"
		              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
				          <div className="overflow-auto">
				            <table className="min-w-[1340px] w-full text-sm border-collapse border border-blue-600">
				              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
					                <tr>
					                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Sort Name</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">CIN</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">GST</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Address</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Firm Phone Number</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Logo</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">T&amp;C</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
				                </tr>
					              </thead>
					              <tbody>
					                {filteredFirms.map((f) => (
						                  <tr key={f.id}>
					                    <td className="px-3 py-2 text-on-surface border border-blue-600">{f.name}</td>
					                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String(f.sortName ?? '').trim() || '-'}</td>
					                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String(f.cin ?? '').trim() || '-'}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String(f.gstNumber ?? '').trim() || '-'}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600 whitespace-normal break-words">{String(f.address ?? '').trim() || '-'}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String(f.phone ?? '').trim() || '-'}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">
				                      {String(f.logoUrl ?? '').trim() ? (
				                        <img
				                          src={String(f.logoUrl ?? '')}
				                          alt="Logo"
				                          className="w-10 h-10 object-contain rounded bg-white border border-outline-variant/20"
				                          referrerPolicy="no-referrer"
				                          onError={(e) => {
				                            (e.currentTarget as HTMLImageElement).style.display = 'none';
				                          }}
				                        />
				                      ) : (
				                        '-'
				                      )}
				                    </td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">
				                      {String(f.termsConditions ?? '').trim() ? 'Yes' : '-'}
				                    </td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
							                      <div className="flex items-center gap-2">
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(f.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete firm "${f.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteFirm(f.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

				      {tab === 'departments' ? (
				        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
				          <div className="flex flex-wrap items-center justify-between gap-2">
					            <div className="flex flex-wrap items-center gap-2">
					              <div className="text-sm text-on-surface-variant">
					                Showing: {filteredDepartments.length} / {departments.length}
					              </div>
					              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
					            </div>
				            <button
				              type="button"
				              className="btn btn-primary disabled:opacity-50"
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
				                {filteredDepartments.map((d) => (
				                  <tr key={d.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{d.name}</td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
							                      <div className="flex items-center gap-2">
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(d.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete department "${d.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteDepartment(d.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

				      {tab === 'states' ? (
				        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
				          <div className="flex flex-wrap items-center justify-between gap-2">
					            <div className="flex flex-wrap items-center gap-2">
					              <div className="text-sm text-on-surface-variant">Showing: {filteredStates.length} / {states.length}</div>
					              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
					            </div>
				            <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
				              Add
				            </button>
				          </div>
				          <div className="overflow-auto">
				            <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
				              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
				                <tr>
				                  <th className="text-left px-3 py-2 border border-blue-600">State</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
				                </tr>
				              </thead>
				              <tbody>
				                {filteredStates.map((s) => (
				                  <tr key={s.id}>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
				                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
				                      <div className="flex items-center gap-2">
				                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(s.id)}>
				                          Edit
				                        </button>
				                        <button
				                          type="button"
				                          title="Delete"
				                          aria-label="Delete"
				                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
				                          onClick={() => {
				                            if (!window.confirm(`Delete state "${s.name}"?`)) return;
				                            setBusy(true);
				                            setError(null);
				                            deleteState(s.id, { deletedBy: 'system' })
				                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

					      {tab === 'cities' ? (
					        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
					          <div className="flex flex-wrap items-center justify-between gap-2">
					            <div className="flex flex-wrap items-center gap-2">
					              <div className="text-sm text-on-surface-variant">Showing: {filteredCities.length} / {cities.length}</div>
					              <input
					                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
					                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
					              ) : null}
					            </div>
					            <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
					              Add
					            </button>
					          </div>
                    
					          <div className="space-y-5">
                      {groupedCities.map((group) => (
                        <div key={group.state} className="rounded-xl border border-outline-variant/15 overflow-hidden">
                          <div className="px-4 py-3 bg-surface-container-low border-b border-outline-variant/15">
                            <h1 className="text-2xl font-bold text-on-surface">{group.state}</h1>
                          </div>
                          <div className="overflow-auto">
                            <table className="min-w-[720px] w-full text-sm border-collapse border border-blue-600">
                              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                                <tr>
                                  <th className="text-left px-3 py-2 border border-blue-600">City</th>
                                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.cities.map((c) => (
                                  <tr key={c.id}>
                                    <td className="px-3 py-2 text-on-surface border border-blue-600">{c.name}</td>
                                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
                                      <div className="flex items-center gap-2">
                                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(c.id)}>
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          title="Delete"
                                          aria-label="Delete"
                                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                                          onClick={() => {
                                            if (!window.confirm(`Delete city "${c.name}"?`)) return;
                                            setBusy(true);
                                            setError(null);
                                            deleteCity(c.id, { deletedBy: 'system' })
                                              .then(() => refreshCurrentTab(tab))
                                              .catch(handleMasterError)
                                              .finally(() => setBusy(false));
                                          }}
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
					          </div>
					        </div>
					      ) : null}

				      {tab === 'stores' ? (
				        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
				          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">Showing: {filteredStores.length} / {stores.length}</div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				              <input
				                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
				                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
		            <button
		              type="button"
		              className="btn btn-primary disabled:opacity-50"
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
				                {filteredStores.map((s) => (
				                  <tr key={s.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">
			                      {firmNameLookup[s.firmId] ?? s.firmId}
				                    </td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.location ?? ''}</td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
							                      <div className="flex items-center gap-2">
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(s.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete store "${s.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteStore(s.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

				      {tab === 'projects' ? (
				        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
				          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">Showing: {filteredProjects.length} / {projects.length}</div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				              <input
				                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
				                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
				            <button
				              type="button"
				              className="btn btn-primary disabled:opacity-50"
				              onClick={openAddModal}
			            >
			              Add
			            </button>
			          </div>
			          <div className="overflow-auto">
			            <table className="min-w-[1320px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Firm</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Project Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Customer Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Date</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">End Date</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Status</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
				              </thead>
				              <tbody>
				                {filteredProjects.map((p) => (
				                  <tr key={p.id}>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">
				                      {firmNameLookup[p.firmId] ?? p.firmId}
				                    </td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{p.name}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{p.clientName ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{p.startDate ? formatDateDDMMYYYYOnly(p.startDate) : ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{p.endDate ? formatDateDDMMYYYYOnly(p.endDate) : ''}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{p.status ?? ''}</td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
							                      <div className="flex items-center gap-2">
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
			                          onClick={() => openEditModal(p.id)}
			                        >
			                          Edit
			                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete project \"${p.name}\"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteProject(p.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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
				          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">Showing: {filteredUsers.length} / {users.length}</div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				              <input
				                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
				                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
					              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
				            <button
				              type="button"
				              className="btn btn-primary disabled:opacity-50"
				              onClick={openAddModal}
			            >
			              Add
			            </button>
			          </div>
				          <div className="overflow-auto">
				            <table className="min-w-[1400px] w-full text-sm border-collapse border border-blue-600">
				              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
				                <tr>
				                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Login ID</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Role</th>
                          <th className="text-left px-3 py-2 border border-blue-600">PO Approval Amount</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Status</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Email</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Password</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Mobile</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
				                </tr>
					              </thead>
					              <tbody>
					                {filteredUsers.map((u) => (
					                  <tr key={u.id}>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.name}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String((u as any).loginId ?? '')}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String((u as any).role ?? u.designation ?? '')}</td>
                            <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(u as any).poApprovalAmount ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">
				                      {(u as any).isActive === false ? 'Inactive' : 'Active'}
				                    </td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{u.email ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.hasPassword ? '********' : ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{u.mobile ?? ''}</td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
							                      <div className="flex items-center gap-2">
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(u.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete user "${u.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteUser(u.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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
				          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">
				                Showing: {filteredSuppliers.length} / {suppliers.length}
				              </div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				              <input
				                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
				                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
			            <button
		              type="button"
		              className="btn btn-primary disabled:opacity-50"
		              onClick={openAddModal}
	            >
	              Add
	            </button>
		          </div>
			          <div className="overflow-auto">
					            <table className="min-w-[1100px] w-full text-sm border-collapse border border-blue-600">
					              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
					                <tr>
					                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">GST</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">GST Type</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Address</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Mobile 1</th>
                                <th className="text-left px-3 py-2 border border-blue-600">Mobile 2</th>
                                <th className="text-left px-3 py-2 border border-blue-600">Contact Person</th>
                                <th className="text-left px-3 py-2 border border-blue-600">Contact Person Mobile</th>
                                <th className="text-left px-3 py-2 border border-blue-600">City</th>
                                <th className="text-left px-3 py-2 border border-blue-600">State</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Payment Terms</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Vendor</th>
                        <th className="text-left px-3 py-2 border border-blue-600">Catalogue Link</th>
					                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
					                </tr>
						              </thead>
						              <tbody>
						                {filteredSuppliers.map((s) => (
						                  <tr key={s.id}>
					                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.gstNumber ?? ''}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.gstType ?? ''}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600 whitespace-normal break-words">{s.address ?? ''}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.phone ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(s as any).mobile2 ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(s as any).contactPerson ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(s as any).contactPersonMobile ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(s as any).city ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(s as any).state ?? ''}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{s.paymentTerms ?? ''}</td>
					                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">
					                      {s.isVendor ? (
					                        <span className="bg-success-container text-on-success-container px-2 py-0.5 rounded text-[10px] font-bold uppercase">Vendor</span>
					                      ) : '-'}
					                    </td>
                          <td className="px-3 py-2 text-on-surface-variant border border-blue-600 whitespace-normal break-words">
                            {(() => {
                              const link = String((s as any).catalogueLink ?? '').trim();
                              if (!link) return '';
                              return (
                                <a
                                  className="btn-sm inline-flex bg-sky-500 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Catalogue
                                </a>
                              );
                            })()}
                          </td>
					                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
					                      <div className="flex items-center gap-2">
				                        <button
				                          type="button"
				                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(s.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteSupplier(s.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

					      {tab === 'customers' ? (
					        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
					          <div className="flex flex-wrap items-center justify-between gap-2">
					            <div className="flex flex-wrap items-center gap-2">
					              <div className="text-sm text-on-surface-variant">
					                Showing: {filteredCustomers.length} / {customers.length}
					              </div>
					              <input
					                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
					                value={listQuery}
					                onChange={(e) => setListQuery(e.target.value)}
					                placeholder="Search anything..."
					              />
	                        
					              {listQuery ? (
					                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
					                  Clear
				                </button>
				              ) : null}
				            </div>
				            <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
				              Add
				            </button>
			          </div>
			          <div className="overflow-auto">
				            <table className="min-w-[1600px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
				                  <th className="text-left px-3 py-2 border border-blue-600">Customer Name</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Category Name</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Sub-Category Name</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">City</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">State</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Contact Person</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Contact Number</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Email ID</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Customer Mobile</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Customer Address</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
				              </thead>
				              <tbody>
				                {filteredCustomers.map((c) => (
				                  <tr key={c.id}>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600">{c.name}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).categoryName ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).subCategoryName ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).city ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).state ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).contactPerson ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).contactNumber ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(c as any).emailId ?? ''}</td>
				                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{c.phone ?? ''}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600 whitespace-normal break-words">{c.address ?? ''}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(c.id)}>
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          title="Delete"
			                          aria-label="Delete"
			                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
			                          onClick={() => {
			                            if (!window.confirm(`Delete customer "${c.name}"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteCustomer(c.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
			                              .catch(handleMasterError)
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          <Trash2 size={16} />
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

					      {tab === 'transporters' ? (
					        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
				          <div className="flex flex-wrap items-center justify-between gap-2">
			            <div className="flex flex-wrap items-center gap-2">
			              <div className="text-sm text-on-surface-variant">
			                Showing: {filteredTransporters.length} / {transporters.length}
			              </div>
			              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
			              <input
			                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                value={listQuery}
			                onChange={(e) => setListQuery(e.target.value)}
			                placeholder={searchPlaceholder}
			              />
			              {listQuery ? (
			                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
			                  Clear
			                </button>
			              ) : null}
			            </div>
			            <button
			              type="button"
			              className="btn btn-primary disabled:opacity-50"
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
		                  <th className="text-left px-3 py-2 border border-blue-600">Phone</th>
		                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
		                </tr>
			              </thead>
			              <tbody>
			                {filteredTransporters.map((t) => (
			                  <tr key={t.id}>
		                    <td className="px-3 py-2 text-on-surface border border-blue-600">{t.name}</td>
		                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{t.phone ?? ''}</td>
		                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
		                      <div className="flex items-center gap-2">
		                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(t.id)}>
		                          Edit
		                        </button>
		                        <button
		                          type="button"
		                          title="Delete"
		                          aria-label="Delete"
		                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
		                          onClick={() => {
		                            if (!window.confirm(`Delete transporter "${t.name}"?`)) return;
		                            setBusy(true);
		                            setError(null);
		                            deleteTransporter(t.id, { deletedBy: 'system' })
		                              .then(() => refreshCurrentTab(tab))
		                              .catch(handleMasterError)
		                              .finally(() => setBusy(false));
		                          }}
		                        >
		                          <Trash2 size={16} />
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

					      {tab === 'units' ? (
					        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
					          <div className="flex flex-wrap items-center justify-between gap-2">
						            <div className="flex flex-wrap items-center gap-2">
						              <div className="text-sm text-on-surface-variant">Showing: {filteredUnits.length} / {units.length}</div>
						              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
						            </div>
					            <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
					              Add
					            </button>
				          </div>
				          <div className="overflow-auto">
				            <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Unit</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
				              </thead>
				              <tbody>
				                {filteredUnits.map((u) => (
				                  <tr key={u.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{u.name}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(u.id)}>
			                          Edit
			                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete unit "${u.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteUnit(u.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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

	              {tab === 'priorities' ? (
	                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
	                  <div className="flex flex-wrap items-center justify-between gap-2">
	                    <div className="flex flex-wrap items-center gap-2">
		                      <div className="text-sm text-on-surface-variant">
		                        Showing: {filteredPriorities.length} / {priorities.length}
		                      </div>
		                      <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
		                    </div>
	                    <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
	                      Add
	                    </button>
                  </div>
                  <div className="overflow-auto">
                    <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
                      <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
                        <tr>
                          <th className="text-left px-3 py-2 border border-blue-600">Priority</th>
                          <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
                        </tr>
	                      </thead>
	                      <tbody>
	                        {filteredPriorities.map((p) => (
	                          <tr key={p.id}>
                            <td className="px-3 py-2 text-on-surface border border-blue-600">{p.name}</td>
                            <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(p.id)}>
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  title="Delete"
                                  aria-label="Delete"
                                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
                                  onClick={() => {
                                    if (!window.confirm(`Delete priority "${p.name}"?`)) return;
                                    setBusy(true);
                                    setError(null);
                                    deletePriority(p.id, { deletedBy: 'system' })
                                      .then(() => refreshCurrentTab(tab))
                                      .catch(handleMasterError)
                                      .finally(() => setBusy(false));
                                  }}
                                >
                                  <Trash2 size={16} />
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
	
					      {tab === 'itemCategories' ? (
					        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
					          <div className="flex flex-wrap items-center justify-between gap-2">
						            <div className="flex flex-wrap items-center gap-2">
						              <div className="text-sm text-on-surface-variant">
						                Showing: {filteredItemCategories.length} / {itemCategories.length}
						              </div>
						              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
						            </div>
				            <button type="button" className="btn btn-primary disabled:opacity-50" onClick={openAddModal}>
				              Add
				            </button>
			          </div>
			          <div className="overflow-auto">
			            <table className="min-w-[520px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Category</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
				              </thead>
				              <tbody>
				                {filteredItemCategories.map((c) => (
				                  <tr key={c.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{c.name}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(c.id)}>
			                          Edit
			                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete category "${c.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteItemCategory(c.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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
				          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">Showing: {filteredItemNames.length} / {itemNames.length}</div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				              <input
				                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
				                value={listQuery}
				                onChange={(e) => setListQuery(e.target.value)}
				                placeholder={searchPlaceholder}
				              />
				              {listQuery ? (
				                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
				                  Clear
				                </button>
				              ) : null}
				            </div>
		            <button
		              type="button"
		              className="btn btn-primary disabled:opacity-50"
		              onClick={openAddModal}
	            >
	              Add
	            </button>
			          </div>
				          <div className="overflow-auto">
					            <table className="min-w-[1200px] w-full text-sm border-collapse border border-blue-600">
					              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
						                <tr>
						                  <th className="text-left px-3 py-2 border border-blue-600">Name</th>
						                  <th className="text-left px-3 py-2 border border-blue-600">Unit</th>
						                  <th className="text-left px-3 py-2 border border-blue-600">Category</th>
                              <th className="text-left px-3 py-2 border border-blue-600">Type</th>
						                  <th className="text-left px-3 py-2 border border-blue-600">Specifications</th>
	                        <th className="text-left px-3 py-2 border border-blue-600">Catalogue Link</th>
						                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
						                </tr>
						              </thead>
						              <tbody>
						                {filteredItemNames.map((n) => (
						                  <tr key={n.id}>
						                    <td className="px-3 py-2 text-on-surface border border-blue-600">{n.name}</td>
						                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{n.unitName ?? ''}</td>
						                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{n.itemCategoryName ?? ''}</td>
                              <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{String((n as any).type ?? 'Goods')}</td>
						                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">
					                      {(() => {
					                        const ids = Array.isArray((n as any).specificationIds)
					                          ? ((n as any).specificationIds as any[]).map((x) => String(x))
					                          : [];
					                        if (!ids.length) return '';
					                        return ids
					                          .map((id) => specNameLookup[id] ?? id)
					                          .filter(Boolean)
					                          .join(', ');
					                      })()}
					                    </td>
                          <td className="px-3 py-2 text-on-surface-variant border border-blue-600 whitespace-normal break-words">
                            {(() => {
                              const link = String((n as any).catalogueLink ?? '').trim();
                              if (!link) return '';
                              return (
                                <a
                                  className="btn-sm inline-flex bg-sky-500 hover:bg-sky-600 text-white px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Catalogue
                                </a>
                              );
                            })()}
                          </td>
						                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
						                      <div className="flex items-center gap-2">
							                        <button
							                          type="button"
							                          title="Download Template"
							                          aria-label={`Download template for ${n.name}`}
							                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-sky-500 text-white shadow-sm hover:bg-sky-600 transition-colors disabled:opacity-50"
							                          disabled={templateBusy}
							                          onClick={() => downloadItemNameItemsTemplate(n.id, n.name)}
							                        >
							                          <Download size={16} />
							                        </button>
							                        <button
						                          type="button"
					                          className="btn-primary btn-sm"
					                          onClick={() => openEditModal(n.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete item name "${n.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteItemName(n.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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
			          <div className="flex flex-wrap items-center justify-between gap-2">
				            <div className="flex flex-wrap items-center gap-2">
				              <div className="text-sm text-on-surface-variant">Showing: {filteredSpecs.length} / {specs.length}</div>
				              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
				            </div>
		            <button
		              type="button"
		              className="btn btn-primary disabled:opacity-50"
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
				                {filteredSpecs.map((s) => (
				                  <tr key={s.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{s.name}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
				                        <button
				                          type="button"
				                          className="btn-primary btn-sm"
				                          onClick={() => openEditModal(s.id)}
				                        >
				                          Edit
				                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete specification "${s.name}"?`)) return;
					                            setBusy(true);
				                            setError(null);
			                            deleteSpecification(s.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab(tab))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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
		
			          <div className="flex flex-wrap items-center justify-between gap-2">
			            <div className="flex flex-wrap items-center gap-2">
			              <div className="text-sm text-on-surface-variant">
			                Showing: {filteredSpecValues.length} / {specValues.length}
			              </div>
			              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
			              <input
			                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
			                value={listQuery}
			                onChange={(e) => setListQuery(e.target.value)}
			                placeholder={searchPlaceholder}
			              />
				              {listQuery ? (
			                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
			                  Clear
			                </button>
			              ) : null}
			            </div>
			            <button
			              type="button"
			              className="btn btn-primary disabled:opacity-50"
			              onClick={openAddModal}
		            >
		              Add
		            </button>
		          </div>
		          <div className="overflow-auto">
			            <table className="min-w-[1100px] w-full text-sm border-collapse border border-blue-600">
			              <thead className="text-xs uppercase tracking-wider text-on-surface-variant">
			                <tr>
			                  <th className="text-left px-3 py-2 border border-blue-600">Item Name</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Specification</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Value</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Used</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
				              </thead>
				              <tbody>
				                {filteredSpecValues.map((v) => (
				                  <tr key={v.id}>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{String((v as any).itemName ?? '')}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">
			                      {specNameLookup[v.specificationId] ?? v.specificationId}
			                    </td>
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{v.value}</td>
			                    <td className="px-3 py-2 text-on-surface-variant border border-blue-600">{(v as any).isUsed ? 'Yes' : 'No'}</td>
			                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
			                        <button type="button" className="btn-primary btn-sm" onClick={() => openEditModal(v.id)}>
			                          Edit
			                        </button>
			                        <button
			                          type="button"
			                          title="Delete"
			                          aria-label="Delete"
			                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
			                          disabled={(v as any).isUsed}
			                          onClick={() => {
			                            if ((v as any).isUsed) return;
			                            if (!window.confirm(`Delete value \"${v.value}\"?`)) return;
			                            setBusy(true);
			                            setError(null);
			                            deleteSpecificationValue(v.id, { deletedBy: 'system' })
			                              .then(() => refreshCurrentTab('specValues'))
			                              .catch(handleMasterError)
			                              .finally(() => setBusy(false));
			                          }}
			                        >
			                          <Trash2 size={16} />
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

	      {tab === 'items' ? (
	        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/5 p-5 shadow-sm space-y-3">
	          <div className="flex flex-wrap items-center justify-between gap-2">
	            <div className="flex flex-wrap items-center gap-2">
	              <div className="text-sm text-on-surface-variant">Showing: {filteredItems.length} / {items.length}</div>
	              <MultiSelectFilter options={listFieldOptions} values={listFields} onChange={setListFields} />
	              <input
	                className="w-full sm:w-72 h-10 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm outline-none"
	                value={listQuery}
	                onChange={(e) => setListQuery(e.target.value)}
	                placeholder={searchPlaceholder}
	              />
	              {listQuery ? (
	                <button type="button" className="btn btn-sm" onClick={() => setListQuery('')}>
	                  Clear
	                </button>
	              ) : null}
	            </div>
	            <button
	              type="button"
	              className="btn btn-primary disabled:opacity-50"
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
                            <th className="text-left px-3 py-2 border border-blue-600">Opening Stock</th>
                          <th className="text-left px-3 py-2 border border-blue-600">Photo</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Item Link</th>
				                  <th className="text-left px-3 py-2 border border-blue-600">Video Link</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Re-Order Level</th>
			                  <th className="text-left px-3 py-2 border border-blue-600">Actions</th>
			                </tr>
	              </thead>
	              <tbody>
	                {filteredItems.map((it) => (
	                  <tr key={it.id} className="align-top">
			                    <td className="px-3 py-2 text-on-surface border border-blue-600">{it.itemName}</td>
						                    <td className="px-3 py-2 text-on-surface border border-blue-600 break-words max-w-[420px]">
						                      {formatItemInline(it.itemName, it.specificationsJson, specNameLookup)}
						                    </td>
	                            <td className="px-3 py-2 text-on-surface border border-blue-600 tabular-nums">
                                <div className="inline-flex items-center gap-2">
	                                <span>{(() => {
	                                  const raw = (it as any).openingStock;
	                                  if (raw == null || String(raw).trim() === '') return '0';
	                                  const n = Number(raw);
	                                  return Number.isFinite(n) ? n : String(raw);
	                                })()}</span>
                                  <button
                                    type="button"
                                    title="View store-wise opening stock"
                                    aria-label="View store-wise opening stock"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-outline-variant/30 hover:bg-surface-container-low"
                                    onClick={() => showItemOpeningStockByStore(it.id, formatItemInline(it.itemName, it.specificationsJson, specNameLookup))}
                                  >
                                    <Eye size={14} />
                                  </button>
                                </div>
	                            </td>
                          <td className="px-3 py-2 text-on-surface border border-blue-600">
                            {(() => {
                              const photos = [
                                String((it as any).photo1 ?? '').trim(),
                                String((it as any).photo2 ?? '').trim(),
                                String((it as any).photo3 ?? '').trim(),
                                String((it as any).photo4 ?? '').trim(),
                                String((it as any).photo5 ?? '').trim(),
                              ].filter(Boolean);
                              const src = photos[0] ?? '';
                              if (!src) return '-';
                              return (
                                <img
                                  src={src}
                                  alt="Item"
                                  className="w-10 h-10 object-cover rounded border border-outline-variant/30 bg-white"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              );
                            })()}
                          </td>
					                    <td className="px-3 py-2 text-on-surface border border-blue-600 break-words max-w-[220px]">
					                      {String((it as any).itemLink ?? '').trim() || '-'}
					                    </td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600 break-words max-w-[220px]">
				                      {String((it as any).videoLink ?? '').trim() || '-'}
				                    </td>
				                    <td className="px-3 py-2 text-on-surface border border-blue-600 tabular-nums">
				                      {(() => {
				                        const raw = (it as any).reorderLevel;
				                        if (raw == null || String(raw).trim() === '') return '-';
				                        const n = Number(raw);
				                        return Number.isFinite(n) ? n : String(raw);
				                      })()}
				                    </td>
				                    <td className="px-3 py-2 border border-blue-600 whitespace-nowrap">
			                      <div className="flex items-center gap-2">
				                        <button
			                          type="button"
			                          className="btn-primary btn-sm"
			                          onClick={() => openEditModal(it.id)}
			                        >
			                          Edit
			                        </button>
					                        <button
					                          type="button"
					                          title="Delete"
					                          aria-label="Delete"
					                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-error text-on-primary shadow-sm hover:bg-error/90 transition-colors disabled:opacity-50"
					                          onClick={() => {
					                            if (!window.confirm(`Delete item "${it.itemName}"?`)) return;
					                            setBusy(true);
				                            setError(null);
		                            deleteItem(it.id, { deletedBy: 'system' })
		                              .then(() => fetchItems().then(setItems))
				                              .catch(handleMasterError)
				                              .finally(() => setBusy(false));
				                          }}
				                        >
				                          <Trash2 size={16} />
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


