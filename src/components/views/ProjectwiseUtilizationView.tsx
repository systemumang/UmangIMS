import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
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
  const [selectedProjectId, setSelectedProjectId] = useState('');

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

  const projectOptions = useMemo(() => rows.map((r) => ({ value: r.projectId, label: r.projectName })), [rows]);
  const selectedRow = rows.find((r) => r.projectId === selectedProjectId) ?? null;

  const escapeHtml = (value: unknown) => String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const handleDownloadExcel = () => {
    if (!selectedRow) return;
    const html = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <h3>${escapeHtml(selectedRow.projectName)}</h3>
          <p>Total Issue: ${selectedRow.totalIssue} | Total Return: ${selectedRow.totalReturn} | Utilization: ${selectedRow.utilization}</p>
          <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;">
            <thead>
              <tr style="background:#1d4ed8;color:#fff;text-transform:uppercase;font-size:11px;">
                <th style="text-align:left;">Items</th>
                <th style="text-align:right;">Issue</th>
                <th style="text-align:right;">Return</th>
                <th style="text-align:right;">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${selectedRow.items
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.label)}</td>
                  <td style="text-align:right;">${it.issueQty}</td>
                  <td style="text-align:right;">${it.returnQty}</td>
                  <td style="text-align:right;">${it.balanceQty}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `.trim();
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedRow.projectName.replace(/[^a-z0-9]+/gi, '_')}_utilization.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!selectedRow) return;
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(selectedRow.projectName)} Utilization</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 16px; }
            h1 { font-size: 16px; margin: 0 0 8px; }
            p { font-size: 12px; margin: 0 0 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #000; padding: 6px; vertical-align: top; }
            th { background: #1d4ed8; color: #fff; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
            td.num, th.num { text-align: right; white-space: nowrap; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(selectedRow.projectName)}</h1>
          <p>Total Issue: ${selectedRow.totalIssue} | Total Return: ${selectedRow.totalReturn} | Utilization: ${selectedRow.utilization}</p>
          <table>
            <thead>
              <tr>
                <th>Items</th>
                <th class="num">Issue</th>
                <th class="num">Return</th>
                <th class="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${selectedRow.items
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.label)}</td>
                  <td class="num">${it.issueQty}</td>
                  <td class="num">${it.returnQty}</td>
                  <td class="num">${it.balanceQty}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `.trim();
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 flex-wrap">
          <div className="font-headline font-bold text-sm text-on-surface">Projectwise Utilization</div>
          <div className="flex items-center gap-2">
            <div className="w-72">
              <SearchableSelect
                value={selectedProjectId}
                options={projectOptions}
                onChange={setSelectedProjectId}
                placeholder="Select Project..."
                allowClear
              />
            </div>
            <button
              type="button"
              className="btn btn-sm h-[38px] px-3 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Download Excel"
              onClick={handleDownloadExcel}
              disabled={!selectedRow}
            >
              <FileSpreadsheet size={16} className="mr-1" />
              Excel
            </button>
            <button
              type="button"
              className="btn btn-sm h-[38px] px-3 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Download PDF"
              onClick={handleDownloadPdf}
              disabled={!selectedRow}
            >
              <Download size={16} className="mr-1" />
              PDF
            </button>
          </div>
        </div>

        {!selectedRow ? (
          <div className="px-4 py-10 text-center text-sm text-on-surface-variant">
            Select a project to view its utilization details.
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Issue</div>
                <div className="text-lg font-semibold text-on-surface">{selectedRow.totalIssue}</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Return</div>
                <div className="text-lg font-semibold text-on-surface">{selectedRow.totalReturn}</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Utilization</div>
                <div className="text-lg font-semibold text-on-surface">{selectedRow.utilization}</div>
              </div>
            </div>

            <table className="project-utilization-items-table w-full text-sm border-2 border-outline-variant rounded-lg overflow-hidden border-collapse outline outline-1 outline-outline-variant">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider">
                  <th className="px-3 py-2 border border-outline-variant bg-white !text-black !opacity-100">Items</th>
                  <th className="px-3 py-2 text-right border border-outline-variant bg-white !text-black !opacity-100">Issue</th>
                  <th className="px-3 py-2 text-right border border-outline-variant bg-white !text-black !opacity-100">Return</th>
                  <th className="px-3 py-2 text-right border border-outline-variant bg-white !text-black !opacity-100">Balance</th>
                </tr>
              </thead>
              <tbody>
                {selectedRow.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-on-surface-variant border border-outline-variant">
                      No items found.
                    </td>
                  </tr>
                ) : (
                  selectedRow.items.map((it) => (
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
          </div>
        )}
      </div>
    </div>
  );
}
