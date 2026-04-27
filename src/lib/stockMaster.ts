export type StockTransactionItem = {
  item: string;
  quantity: number;
  specification?: string;
};

export type StockTransaction = {
  id: string;
  transactionNo: string;
  firmId: string;
  department: string;
  person: string;
  date: string;
  issueType?: 'Sales' | 'Project';
  issuedTo?: string;
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

export async function deleteDamage(id: string) {
  const damages = getStorage('stock_damages');
  setStorage('stock_damages', damages.filter(i => i.id !== id));
}
