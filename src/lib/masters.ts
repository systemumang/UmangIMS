export type Firm = {
  id: string;
  name: string;
  cin?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  termsConditions?: string | null;
};
export type Store = { id: string; firmId: string; name: string; location?: string | null };
export type Supplier = {
  id: string;
  name: string;
  gstNumber?: string | null;
  gstType?: 'Intra-State' | 'Inter-State' | null;
  address?: string | null;
  phone?: string | null;
  paymentTerms?: string | null;
};
export type Transporter = { id: string; name: string; phone?: string | null };
export type Department = { id: string; name: string };
export type Project = {
  id: string;
  firmId: string;
  name: string;
  clientName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
};
export type Unit = { id: string; name: string };
export type ItemCategory = { id: string; name: string };
export type ItemName = {
  id: string;
  name: string;
  unitId?: string | null;
  unitName?: string | null;
  itemCategoryId?: string | null;
  itemCategoryName?: string | null;
};
export type Specification = { id: string; name: string };
export type SpecificationValue = { id: string; specificationId: string; value: string; isActive: boolean };
export type User = {
  id: string;
  name: string;
  email?: string | null;
  designation: string;
  mobile?: string | null;
  hasPassword: boolean;
};
export type Item = {
  id: string;
  itemNameId: string;
  itemCode: string;
  itemName: string;
  specificationsJson: string;
  uniqueKey: string;
  description?: string | null;
  unit?: string | null;
};

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function requireOk<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await readJsonSafe<T & { error?: string }>(res);
  if (!res.ok) {
    const serverMessage = (data as any)?.error;
    throw new Error(serverMessage ? String(serverMessage) : `${fallbackMessage} (${res.status})`);
  }
  if (data === null) throw new Error(`${fallbackMessage} (${res.status})`);
  return data as T;
}

export async function fetchFirms(signal?: AbortSignal): Promise<Firm[]> {
  const res = await fetch('/api/masters/firms', { signal });
  const data = await requireOk<{ firms?: Firm[] }>(res, 'Failed to load firms');
  const rows = Array.isArray(data.firms) ? data.firms : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFirm(input: {
  name: string;
  cin?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  termsConditions?: string | null;
  createdBy?: string;
}) {
  const res = await fetch('/api/masters/firms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ firm?: Firm }>(res, 'Failed to create firm');
}

export async function updateFirm(
  id: string,
  input: {
    name: string;
    cin?: string | null;
    gstNumber?: string | null;
    address?: string | null;
    phone?: string | null;
    logoUrl?: string | null;
    termsConditions?: string | null;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/masters/firms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ firm?: Firm }>(res, 'Failed to update firm');
}

export async function deleteFirm(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/firms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete firm');
}

export async function fetchStores(signal?: AbortSignal): Promise<Store[]> {
  const res = await fetch('/api/masters/stores', { signal });
  const data = await requireOk<{ stores?: Store[] }>(res, 'Failed to load stores');
  const rows = Array.isArray(data.stores) ? data.stores : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchUsers(signal?: AbortSignal): Promise<User[]> {
  const res = await fetch('/api/masters/users', { signal });
  const data = await requireOk<{ users?: User[] }>(res, 'Failed to load users');
  const rows = Array.isArray(data.users) ? data.users : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDepartments(signal?: AbortSignal): Promise<Department[]> {
  const res = await fetch('/api/masters/departments', { signal });
  const data = await requireOk<{ departments?: Department[] }>(res, 'Failed to load departments');
  const rows = Array.isArray(data.departments) ? data.departments : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchProjects(signal?: AbortSignal): Promise<Project[]> {
  const res = await fetch('/api/masters/projects', { signal });
  const data = await requireOk<{ projects?: Project[] }>(res, 'Failed to load projects');
  const rows = Array.isArray(data.projects) ? data.projects : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(input: {
  firmId: string;
  name: string;
  clientName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  createdBy?: string;
}) {
  const res = await fetch('/api/masters/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ project?: Project }>(res, 'Failed to create project');
}

export async function updateProject(
  id: string,
  input: {
    firmId: string;
    name: string;
    clientName?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    status?: string | null;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/masters/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ project?: Project }>(res, 'Failed to update project');
}

export async function deleteProject(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete project');
}

export async function createDepartment(input: { name: string; createdBy?: string }) {
  const res = await fetch('/api/masters/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ department?: Department }>(res, 'Failed to create department');
}

export async function updateDepartment(id: string, input: { name: string; updatedBy?: string }) {
  const res = await fetch(`/api/masters/departments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ department?: Department }>(res, 'Failed to update department');
}

export async function deleteDepartment(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/departments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete department');
}

export async function createUser(input: { name: string; email: string; designation: string; password: string; mobile?: string; createdBy?: string }) {
  const res = await fetch('/api/masters/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ user?: User }>(res, 'Failed to create user');
}

export async function updateUser(
  id: string,
  input: { name: string; email: string; designation: string; password?: string; mobile?: string; updatedBy?: string }
) {
  const res = await fetch(`/api/masters/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ user?: User }>(res, 'Failed to update user');
}

export async function deleteUser(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete user');
}

export async function createStore(input: { firmId: string; name: string; location?: string; createdBy?: string }) {
  const res = await fetch('/api/masters/stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ store?: Store }>(res, 'Failed to create store');
}

export async function updateStore(id: string, input: { firmId: string; name: string; location?: string; updatedBy?: string }) {
  const res = await fetch(`/api/masters/stores/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ store?: Store }>(res, 'Failed to update store');
}

export async function deleteStore(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/stores/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete store');
}

export async function fetchSuppliers(signal?: AbortSignal): Promise<Supplier[]> {
  const res = await fetch('/api/masters/suppliers', { signal });
  const data = await requireOk<{ suppliers?: Supplier[] }>(res, 'Failed to load suppliers');
  const rows = Array.isArray(data.suppliers) ? data.suppliers : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSupplier(input: {
  name: string;
  gstNumber?: string;
  gstType?: 'Intra-State' | 'Inter-State';
  address?: string;
  phone?: string;
  paymentTerms?: string;
  createdBy?: string;
}) {
  const res = await fetch('/api/masters/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ supplier?: Supplier }>(res, 'Failed to create supplier');
}

export async function updateSupplier(
  id: string,
  input: {
    name: string;
    gstNumber?: string;
    gstType?: 'Intra-State' | 'Inter-State';
    address?: string;
    phone?: string;
    paymentTerms?: string;
    updatedBy?: string;
  }
) {
  const res = await fetch(`/api/masters/suppliers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ supplier?: Supplier }>(res, 'Failed to update supplier');
}

export async function deleteSupplier(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/suppliers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete supplier');
}

export async function fetchTransporters(signal?: AbortSignal): Promise<Transporter[]> {
  const res = await fetch('/api/masters/transporters', { signal });
  const data = await requireOk<{ transporters?: Transporter[] }>(res, 'Failed to load transporters');
  const rows = Array.isArray(data.transporters) ? data.transporters : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTransporter(input: { name: string; phone?: string; createdBy?: string }) {
  const res = await fetch('/api/masters/transporters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ transporter?: Transporter }>(res, 'Failed to create transporter');
}

export async function updateTransporter(id: string, input: { name: string; phone?: string | null; updatedBy?: string }) {
  const res = await fetch(`/api/masters/transporters/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ transporter?: Transporter }>(res, 'Failed to update transporter');
}

export async function deleteTransporter(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/transporters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete transporter');
}

export async function fetchItemNames(signal?: AbortSignal): Promise<ItemName[]> {
  const res = await fetch('/api/masters/item-names', { signal });
  const data = await requireOk<{ itemNames?: ItemName[] }>(res, 'Failed to load item names');
  const rows = Array.isArray(data.itemNames) ? data.itemNames : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchUnits(signal?: AbortSignal): Promise<Unit[]> {
  const res = await fetch('/api/masters/units', { signal });
  const data = await requireOk<{ units?: Unit[] }>(res, 'Failed to load units');
  const rows = Array.isArray(data.units) ? data.units : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createUnit(input: { name: string; createdBy?: string }) {
  const res = await fetch('/api/masters/units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ unit?: Unit }>(res, 'Failed to create unit');
}

export async function updateUnit(id: string, input: { name: string; updatedBy?: string }) {
  const res = await fetch(`/api/masters/units/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ unit?: Unit }>(res, 'Failed to update unit');
}

export async function deleteUnit(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/units/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete unit');
}

export async function fetchItemCategories(signal?: AbortSignal): Promise<ItemCategory[]> {
  const res = await fetch('/api/masters/item-categories', { signal });
  const data = await requireOk<{ itemCategories?: ItemCategory[] }>(res, 'Failed to load item categories');
  const rows = Array.isArray(data.itemCategories) ? data.itemCategories : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createItemCategory(input: { name: string; createdBy?: string }) {
  const res = await fetch('/api/masters/item-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ itemCategory?: ItemCategory }>(res, 'Failed to create item category');
}

export async function updateItemCategory(id: string, input: { name: string; updatedBy?: string }) {
  const res = await fetch(`/api/masters/item-categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ itemCategory?: ItemCategory }>(res, 'Failed to update item category');
}

export async function deleteItemCategory(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/item-categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete item category');
}

export async function createItemName(input: { name: string; unitId?: string | null; itemCategoryId?: string | null; createdBy?: string }) {
  const res = await fetch('/api/masters/item-names', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ itemName?: ItemName }>(res, 'Failed to create item name');
}

export async function updateItemName(id: string, input: { name: string; unitId?: string | null; itemCategoryId?: string | null; updatedBy?: string }) {
  const res = await fetch(`/api/masters/item-names/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ itemName?: ItemName }>(res, 'Failed to update item name');
}

export async function deleteItemName(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/item-names/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete item name');
}

export async function fetchSpecifications(signal?: AbortSignal): Promise<Specification[]> {
  const res = await fetch('/api/masters/specifications', { signal });
  const data = await requireOk<{ specifications?: Specification[] }>(res, 'Failed to load specifications');
  const rows = Array.isArray(data.specifications) ? data.specifications : [];
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSpecification(input: { name: string; createdBy?: string }) {
  const res = await fetch('/api/masters/specifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ specification?: Specification }>(res, 'Failed to create specification');
}

export async function updateSpecification(id: string, input: { name: string; updatedBy?: string }) {
  const res = await fetch(`/api/masters/specifications/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ specification?: Specification }>(res, 'Failed to update specification');
}

export async function deleteSpecification(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/specifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete specification');
}

export async function fetchSpecificationValues(specificationId: string, signal?: AbortSignal): Promise<SpecificationValue[]> {
  const res = await fetch(`/api/masters/specification-values?specificationId=${encodeURIComponent(specificationId)}`, { signal });
  const data = await requireOk<{ specificationValues?: SpecificationValue[] }>(res, 'Failed to load specification values');
  return Array.isArray(data.specificationValues) ? data.specificationValues : [];
}

export async function createSpecificationValue(input: { specificationId: string; value: string; createdBy?: string }) {
  const res = await fetch('/api/masters/specification-values', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ specificationValue?: SpecificationValue }>(res, 'Failed to create specification value');
}

export async function updateSpecificationValue(
  id: string,
  input: { specificationId: string; value: string; updatedBy?: string }
) {
  const res = await fetch(`/api/masters/specification-values/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ specificationValue?: SpecificationValue }>(res, 'Failed to update specification value');
}

export async function deleteSpecificationValue(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/specification-values/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete specification value');
}

export async function fetchItems(signal?: AbortSignal): Promise<Item[]> {
  const res = await fetch('/api/masters/items', { signal });
  const data = await requireOk<{ items?: Item[] }>(res, 'Failed to load items');
  return Array.isArray(data.items) ? data.items : [];
}

export async function createItem(input: {
  itemNameId: string;
  unit?: string;
  description?: string;
  specs: Array<{ specificationId: string; value: string }>;
  createdBy?: string;
}) {
  const res = await fetch('/api/masters/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ item?: Item }>(res, 'Failed to create item');
}

export async function updateItem(
  id: string,
  input: { itemNameId: string; unit?: string; description?: string; specs: Array<{ specificationId: string; value: string }>; updatedBy?: string }
) {
  const res = await fetch(`/api/masters/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return requireOk<{ item?: Item }>(res, 'Failed to update item');
}

export async function deleteItem(id: string, input?: { deletedBy?: string }) {
  const res = await fetch(`/api/masters/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return requireOk<{ ok: boolean }>(res, 'Failed to delete item');
}

export async function saveExcelSnapshot() {
  const res = await fetch('/api/excel/snapshot', { method: 'POST' });
  return requireOk<{ fileName: string }>(res, 'Failed to save Excel snapshot');
}

export async function saveMastersExcelSnapshot() {
  const res = await fetch('/api/excel/masters-snapshot', { method: 'POST' });
  return requireOk<{ fileName: string }>(res, 'Failed to save Masters Excel snapshot');
}
