export type MastersTab =
  | 'firms'
  | 'stores'
  | 'departments'
  | 'users'
  | 'suppliers'
  | 'transporters'
  | 'projects'
  | 'units'
  | 'itemCategories'
  | 'itemNames'
  | 'specs'
  | 'specValues'
  | 'items';

export const MASTERS_TABS: Array<{ key: MastersTab; label: string }> = [
  { key: 'firms', label: 'Firms' },
  { key: 'stores', label: 'Stores' },
  { key: 'departments', label: 'Departments' },
  { key: 'users', label: 'Users' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'transporters', label: 'Transporters' },
  { key: 'projects', label: 'Projects' },
  { key: 'units', label: 'Units' },
  { key: 'itemCategories', label: 'Item Categories' },
  { key: 'itemNames', label: 'Item Names' },
  { key: 'specs', label: 'Specifications' },
  { key: 'specValues', label: 'Spec Values' },
  { key: 'items', label: 'Items' },
];
