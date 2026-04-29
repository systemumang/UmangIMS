export type StockTransactionItem = {
  item: string;
  quantity: number;
  specification?: string;
  remark?: string;
};

export type StockTransaction = {
  id: string;
  transactionNo: string;
  firmId: string;
  store?: string;
  department: string;
  // For Stock Transfer flows
  toFirmId?: string;
  toStore?: string;
  toDepartment?: string;
  person: string;
  date: string;
  issueType?: 'Sales' | 'Project';
  issuedTo?: string;
  returnType?: 'Sales' | 'Project';
  customerName?: string;
  approvedBy?: string;
  items: StockTransactionItem[];
};

function getStorage(key: string): StockTransaction[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function setStorage(key: string, data: StockTransaction[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

function updateById(key: string, id: string, updater: (row: StockTransaction) => StockTransaction) {
  const rows = getStorage(key);
  const next = rows.map((r) => (String(r.id) === String(id) ? updater(r) : r));
  setStorage(key, next);
  return next.find((r) => String(r.id) === String(id)) ?? null;
}

function getById(key: string, id: string) {
  const rows = getStorage(key);
  return rows.find((r) => String(r.id) === String(id)) ?? null;
}

function getFyPrefix() {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  if (month < 3) {
    return `${(year - 1).toString().slice(2)}-${year.toString().slice(2)}`;
  } else {
    return `${year.toString().slice(2)}-${(year + 1).toString().slice(2)}`;
  }
}

export async function createIssue(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const issues = getStorage('stock_issues');
  const nextNum = issues.length + 1;
  const newRow = {
    ...data,
    id: String(Date.now()),
    transactionNo: `ISS/${getFyPrefix()}/${String(nextNum).padStart(5, '0')}`
  };
  setStorage('stock_issues', [newRow, ...issues]);
  return newRow;
}

export async function listIssues() {
  return getStorage('stock_issues');
}

export async function getIssue(id: string) {
  return getById('stock_issues', id);
}

export async function updateIssue(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  return updateById('stock_issues', id, (prev) => ({ ...prev, ...next, id: prev.id, transactionNo: prev.transactionNo }));
}

export async function deleteIssue(id: string) {
  const issues = getStorage('stock_issues');
  setStorage('stock_issues', issues.filter(i => i.id !== id));
}

export async function createReturn(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const returns = getStorage('stock_returns');
  const nextNum = returns.length + 1;
  const newRow = {
    ...data,
    id: String(Date.now()),
    transactionNo: `RET/${getFyPrefix()}/${String(nextNum).padStart(5, '0')}`
  };
  setStorage('stock_returns', [newRow, ...returns]);
  return newRow;
}

export async function listReturns() {
  return getStorage('stock_returns');
}

export async function getReturn(id: string) {
  return getById('stock_returns', id);
}

export async function updateReturn(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  return updateById('stock_returns', id, (prev) => ({ ...prev, ...next, id: prev.id, transactionNo: prev.transactionNo }));
}

export async function deleteReturn(id: string) {
  const returns = getStorage('stock_returns');
  setStorage('stock_returns', returns.filter(i => i.id !== id));
}

export async function createDamage(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const damages = getStorage('stock_damages');
  const nextNum = damages.length + 1;
  const newRow = {
    ...data,
    id: String(Date.now()),
    transactionNo: `DAM/${getFyPrefix()}/${String(nextNum).padStart(5, '0')}`
  };
  setStorage('stock_damages', [newRow, ...damages]);
  return newRow;
}

export async function listDamages() {
  return getStorage('stock_damages');
}

export async function getDamage(id: string) {
  return getById('stock_damages', id);
}

export async function updateDamage(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  return updateById('stock_damages', id, (prev) => ({ ...prev, ...next, id: prev.id, transactionNo: prev.transactionNo }));
}

export async function deleteDamage(id: string) {
  const damages = getStorage('stock_damages');
  setStorage('stock_damages', damages.filter(i => i.id !== id));
}

export async function createTransfer(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const transfers = getStorage('stock_transfers');
  const nextNum = transfers.length + 1;
  const newRow = {
    ...data,
    id: String(Date.now()),
    transactionNo: `TRF/${getFyPrefix()}/${String(nextNum).padStart(5, '0')}`
  };
  setStorage('stock_transfers', [newRow, ...transfers]);
  return newRow;
}

export async function listTransfers() {
  return getStorage('stock_transfers');
}

export async function getTransfer(id: string) {
  return getById('stock_transfers', id);
}

export async function updateTransfer(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  return updateById('stock_transfers', id, (prev) => ({ ...prev, ...next, id: prev.id, transactionNo: prev.transactionNo }));
}

export async function deleteTransfer(id: string) {
  const transfers = getStorage('stock_transfers');
  setStorage('stock_transfers', transfers.filter(i => i.id !== id));
}
