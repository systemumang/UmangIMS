export type MastersTab = 'firms' | 'stores' | 'users' | 'suppliers' | 'itemNames' | 'specs' | 'specValues' | 'items';

export const MASTERS_TABS: Array<{ key: MastersTab; label: string }> = [
  { key: 'firms', label: 'Firms' },
  { key: 'stores', label: 'Stores' },
  { key: 'users', label: 'Users' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'itemNames', label: 'Item Names' },
  { key: 'specs', label: 'Specifications' },
  { key: 'specValues', label: 'Spec Values' },
  { key: 'items', label: 'Items' },
];
