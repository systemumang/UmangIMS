import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { listIssues, listReturns, type StockTransaction } from '@/src/lib/stockMaster';
import { fetchItems, fetchProjects, type Item, type Project } from '@/src/lib/masters';

type ItemUtilization = {
  itemKey: string;
  label: string;
  issueQty: number;
  returnQty: number;
  balanceQty: number;
};

type ProjectUtilizationRow = {
  projectId: string;
  projectName: string;
  totalIssue: number;
  totalReturn: number;
  utilization: number;
  items: ItemUtilization[];
};

export default function ProjectwiseUtilizationView() {
  const [issues, setIssues] = useState<StockTransaction[]>([]);
  const [returns, setReturns] = useState<StockTransaction[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  useEffect(() => {
    listIssues().then(setIssues).catch(() => setIssues([]));
    listReturns().then(setReturns).catch(() => setReturns([]));
    fetchProjects().then(setProjects).catch(() => setProjects([]));
    fetchItems().then(setItems).catch(() => setItems([]));
  }, []);

  const formatSpecs = (specificationsJson: string) => {
    const raw = String(specificationsJson ?? '').trim();
    if (!raw) return '';
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') return '';
      // Specification JSON keys are specification IDs, not names; only values are human-readable.
      const values = Object.values(obj)
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
      return values.join(' - ');
    } catch {
      return '';
    }
  };

  const getItemLabel = (itemId?: string, itemValue?: string) => {
    const id = String(itemId ?? '').trim();
    const raw = String(itemValue ?? '').trim();
    const masterItem =
      items.find((it) => it.id === id) ??
      items.find((it) => String(it.itemCode ?? '').trim() === raw) ??
      items.find((it) => String(it.itemName ?? '').trim().toLowerCase() === raw.toLowerCase());
    if (masterItem) {
      const specText = formatSpecs(masterItem.specificationsJson);
      const parts = [String(masterItem.itemName ?? '').trim(), specText, String(masterItem.description ?? '').trim()].filter(Boolean);
      return parts.join(' - ') || masterItem.itemCode;
    }
    // Raw fallback values may embed "guid: value" spec pairs; strip the guid keys.
    return (
      raw
        .split(' - ')
        .map((part) => part.replace(/^[0-9a-f-]{36}:\s*/i, '').trim())
        .filter(Boolean)
        .join(' - ') || '-'
    );
  };


  const getProjectName = (projectId?: string | null) => {
    const raw = String(projectId ?? '').trim();
    if (!raw) return '';
    return projects.find((p) => p.id === raw)?.name || raw;
  };

  const rows: ProjectUtilizationRow[] = useMemo(() => {
    const byProject = new Map<string, { issues: StockTransaction[]; returns: StockTransaction[] }>();

    for (const row of issues) {
      if (row.issueType !== 'Project') continue;
      const projectId = String(row.projectId ?? '').trim();
      if (!projectId) continue;
      if (!byProject.has(projectId)) byProject.set(projectId, { issues: [], returns: [] });
      byProject.get(projectId)!.issues.push(row);
    }
    for (const row of returns) {
      if (row.returnType !== 'Project') continue;
      const projectId = String(row.projectId ?? '').trim();
      if (!projectId) continue;
      if (!byProject.has(projectId)) byProject.set(projectId, { issues: [], returns: [] });
      byProject.get(projectId)!.returns.push(row);
    }

    const result: ProjectUtilizationRow[] = [];
    for (const [projectId, { issues: projIssues, returns: projReturns }] of byProject) {
      const itemMap = new Map<string, ItemUtilization>();
      let totalIssue = 0;
      let totalReturn = 0;

      for (const tx of projIssues) {
        for (const it of tx.items) {
          const qty = Number(it.quantity) || 0;
          totalIssue += qty;
          const key = String(it.itemId ?? '').trim() || it.item;
          if (!itemMap.has(key)) {
            itemMap.set(key, { itemKey: key, label: getItemLabel(it.itemId, it.item), issueQty: 0, returnQty: 0, balanceQty: 0 });
          }
          itemMap.get(key)!.issueQty += qty;
        }
      }
      for (const tx of projReturns) {
        for (const it of tx.items) {
          const qty = Number(it.quantity) || 0;
          totalReturn += qty;
          const key = String(it.itemId ?? '').trim() || it.item;
          if (!itemMap.has(key)) {
            itemMap.set(key, { itemKey: key, label: getItemLabel(it.itemId, it.item), issueQty: 0, returnQty: 0, balanceQty: 0 });
          }
          itemMap.get(key)!.returnQty += qty;
        }
      }

      const itemRows = Array.from(itemMap.values())
        .map((it) => ({ ...it, balanceQty: it.issueQty - it.returnQty }))
        .sort((a, b) => a.label.localeCompare(b.label));

      result.push({
        projectId,
        projectName: getProjectName(projectId),
        totalIssue,
        totalReturn,
        utilization: totalIssue - totalReturn,
        items: itemRows,
      });
    }

    return result.sort((a, b) => a.projectName.localeCompare(b.projectName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, returns, projects, items]);

  const filtered = rows.filter((r) => r.projectName.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <div className="font-headline font-bold text-sm text-on-surface">Projectwise Utilization</div>
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={14} />
            <input
              type="text"
              placeholder="Search project..."
              className="w-64 bg-surface-container-lowest border border-outline-variant rounded-lg pl-8 pr-3 py-2 text-sm text-on-surface-variant shadow-sm outline-none focus:border-outline-variant focus:ring-2 focus:ring-outline-variant/15"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3 text-right">Total Issue</th>
                <th className="px-4 py-3 text-right">Total Return</th>
                <th className="px-4 py-3 text-right">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-on-surface-variant">
                    No project utilization data found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const isExpanded = expandedProjectId === row.projectId;
                  return (
                    <React.Fragment key={row.projectId}>
                      <tr
                        className="border-t border-outline-variant hover:bg-surface-container-low/60 cursor-pointer"
                        onClick={() => setExpandedProjectId(isExpanded ? null : row.projectId)}
                      >
                        <td className="px-4 py-3 text-on-surface-variant">
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </td>
                        <td className="px-4 py-3 font-semibold text-on-surface">{row.projectName}</td>
                        <td className="px-4 py-3 text-right">{row.totalIssue}</td>
                        <td className="px-4 py-3 text-right">{row.totalReturn}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.utilization}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-outline-variant bg-surface-container-low/40">
                          <td colSpan={5} className="px-4 py-3">
                            <table className="w-full text-sm border-2 border-outline-variant rounded-lg overflow-hidden border-collapse outline outline-1 outline-outline-variant">
                              <thead>
                                <tr className="text-left text-[10px] font-bold uppercase tracking-wider">
                                  <th className="px-3 py-2 border border-outline-variant bg-blue-50 text-slate-700">Items</th>
                                  <th className="px-3 py-2 text-right border border-outline-variant bg-amber-50 text-slate-700">Issue</th>
                                  <th className="px-3 py-2 text-right border border-outline-variant bg-emerald-50 text-slate-700">Return</th>
                                  <th className="px-3 py-2 text-right border border-outline-variant bg-rose-50 text-slate-700">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-3 py-4 text-center text-on-surface-variant border border-outline-variant">
                                      No items found.
                                    </td>
                                  </tr>
                                ) : (
                                  row.items.map((it) => (
                                    <tr key={it.itemKey}>
                                      <td className="px-3 py-2 border border-outline-variant bg-blue-50/40">{it.label}</td>
                                      <td className="px-3 py-2 text-right border border-outline-variant bg-amber-50/40">{it.issueQty}</td>
                                      <td className="px-3 py-2 text-right border border-outline-variant bg-emerald-50/40">{it.returnQty}</td>
                                      <td className="px-3 py-2 text-right font-semibold border border-outline-variant bg-rose-50/40">{it.balanceQty}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
