export type ExpenseReportRow = {
  date: string;
  invoiceNo: string;
  expenses: string;
  expenseId?: string;
  supplier: string;
  amount: number;
};

export type PendingOrderReportRow = {
  itemId: string;
  item: string;
  category: string;
  currentBalance: number;
  closingStock: number;
  poInProgress: number;
  reorderLevel: number;
  shortfall: number;
};

export type StockSummaryRow = PendingOrderReportRow;

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
    throw new Error(String((data as any)?.error ?? `${fallbackMessage} (${res.status})`));
  }
  if (data === null) throw new Error(`${fallbackMessage} (${res.status})`);
  return data as T;
}

export async function fetchExpenseReport(
  filters?: { from?: string; to?: string; expense?: string },
  signal?: AbortSignal
): Promise<ExpenseReportRow[]> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.expense) params.set('expense', filters.expense);
  const qs = params.toString();
  const res = await fetch(`/api/reports/expenses${qs ? `?${qs}` : ''}`, { signal });
  const data = await requireOk<{ rows?: ExpenseReportRow[] }>(res, 'Failed to load expense report');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchPendingOrderReport(signal?: AbortSignal): Promise<PendingOrderReportRow[]> {
  const res = await fetch('/api/reports/pending-order', { signal });
  const data = await requireOk<{ rows?: PendingOrderReportRow[] }>(res, 'Failed to load pending order report');
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function fetchStockSummary(signal?: AbortSignal): Promise<StockSummaryRow[]> {
  const res = await fetch('/api/reports/stock-summary', { signal });
  const data = await requireOk<{ rows?: StockSummaryRow[] }>(res, 'Failed to load stock summary');
  return Array.isArray(data.rows) ? data.rows : [];
}
