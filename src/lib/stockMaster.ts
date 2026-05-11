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
  storeId?: string;
  store?: string;
  department: string;
  projectId?: string;
  toFirmId?: string;
  toStoreId?: string;
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

// Issues API endpoints
export async function createIssue(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch('/api/stock-transactions/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create issue (${res.status})`);
  }
  return res.json();
}

export async function listIssues(): Promise<StockTransaction[]> {
  const res = await fetch('/api/stock-transactions/issues');
  if (!res.ok) throw new Error(`Failed to list issues (${res.status})`);
  const data = await res.json();
  return data.issues || [];
}

export async function getIssue(id: string): Promise<StockTransaction | null> {
  const res = await fetch(`/api/stock-transactions/issues/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get issue (${res.status})`);
  const data = await res.json();
  return data.issue || null;
}

export async function updateIssue(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch(`/api/stock-transactions/issues/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update issue (${res.status})`);
  }
  const data = await res.json();
  return data.issue || null;
}

export async function deleteIssue(id: string) {
  const res = await fetch(`/api/stock-transactions/issues/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete issue (${res.status})`);
}

// Returns API endpoints
export async function createReturn(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch('/api/stock-transactions/returns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create return (${res.status})`);
  }
  return res.json();
}

export async function listReturns(): Promise<StockTransaction[]> {
  const res = await fetch('/api/stock-transactions/returns');
  if (!res.ok) throw new Error(`Failed to list returns (${res.status})`);
  const data = await res.json();
  return data.returns || [];
}

export async function getReturn(id: string): Promise<StockTransaction | null> {
  const res = await fetch(`/api/stock-transactions/returns/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get return (${res.status})`);
  const data = await res.json();
  return data.return || null;
}

export async function updateReturn(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch(`/api/stock-transactions/returns/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update return (${res.status})`);
  }
  const data = await res.json();
  return data.return || null;
}

export async function deleteReturn(id: string) {
  const res = await fetch(`/api/stock-transactions/returns/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete return (${res.status})`);
}

// Damages API endpoints
export async function createDamage(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch('/api/stock-transactions/damages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create damage (${res.status})`);
  }
  return res.json();
}

export async function listDamages(): Promise<StockTransaction[]> {
  const res = await fetch('/api/stock-transactions/damages');
  if (!res.ok) throw new Error(`Failed to list damages (${res.status})`);
  const data = await res.json();
  return data.damages || [];
}

export async function getDamage(id: string): Promise<StockTransaction | null> {
  const res = await fetch(`/api/stock-transactions/damages/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get damage (${res.status})`);
  const data = await res.json();
  return data.damage || null;
}

export async function updateDamage(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch(`/api/stock-transactions/damages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update damage (${res.status})`);
  }
  const data = await res.json();
  return data.damage || null;
}

export async function deleteDamage(id: string) {
  const res = await fetch(`/api/stock-transactions/damages/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete damage (${res.status})`);
}

// Transfers API endpoints
export async function createTransfer(data: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch('/api/stock-transactions/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create transfer (${res.status})`);
  }
  return res.json();
}

export async function listTransfers(): Promise<StockTransaction[]> {
  const res = await fetch('/api/stock-transactions/transfers');
  if (!res.ok) throw new Error(`Failed to list transfers (${res.status})`);
  const data = await res.json();
  return data.transfers || [];
}

export async function getTransfer(id: string): Promise<StockTransaction | null> {
  const res = await fetch(`/api/stock-transactions/transfers/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get transfer (${res.status})`);
  const data = await res.json();
  return data.transfer || null;
}

export async function updateTransfer(id: string, next: Omit<StockTransaction, 'id' | 'transactionNo'>) {
  const res = await fetch(`/api/stock-transactions/transfers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update transfer (${res.status})`);
  }
  const data = await res.json();
  return data.transfer || null;
}

export async function deleteTransfer(id: string) {
  const res = await fetch(`/api/stock-transactions/transfers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete transfer (${res.status})`);
}
