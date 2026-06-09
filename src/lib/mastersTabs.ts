export type MastersTab =
  | 'firms'
  | 'stores'
  | 'departments'
  | 'users'
  | 'suppliers'
  | 'states'
  | 'cities'
  | 'customers'
  | 'transporters'
  | 'projects'
  | 'units'
  | 'priorities'
  | 'itemCategories'
  | 'itemNames'
  | 'specs'
  | 'specValues'
  | 'items';

export const MASTERS_TABS: Array<{ key: MastersTab; label: string }> = [
  { key: 'customers', label: 'Customers' },
  { key: 'cities', label: 'City' },
  { key: 'departments', label: 'Departments' },
  { key: 'firms', label: 'Firms' },
  { key: 'itemCategories', label: 'Item Categories' },
  { key: 'itemNames', label: 'Item Names' },
  { key: 'items', label: 'Items' },
  { key: 'priorities', label: 'Priorities' },
  { key: 'projects', label: 'Projects' },
  { key: 'specValues', label: 'Spec Values' },
  { key: 'specs', label: 'Specifications' },
  { key: 'states', label: 'State' },
  { key: 'stores', label: 'Stores' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'transporters', label: 'Transporters' },
  { key: 'units', label: 'Units' },
  { key: 'users', label: 'Users' },
];
