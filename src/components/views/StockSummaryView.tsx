import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import { listIssues, listReturns, type StockTransaction } from '@/src/lib/stockMaster';
import { fetchFirms, fetchProjects, fetchStores, type Firm, type Project, type Store } from '@/src/lib/masters';

type SummaryLine = {
  id: string;
  date: string;
  firm: string;
  issueTo?: string;
  department: string;
  storeName?: string;
  receivedBy?: string;
  item: string;
  qty: number;
  remarks: string;
};

function formatDate(value: string) {
  if (!value) return '-';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function txDate(value: string) {
  return String(value ?? '').slice(0, 10);
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function StockSummaryView() {
  const [issues, setIssues] = useState<StockTransaction[]>([]);
  const [returns, setReturns] = useState<StockTransaction[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listIssues().catch(() => []),
      listReturns().catch(() => []),
      fetchFirms().catch(() => []),
      fetchProjects().catch(() => []),
      fetchStores().catch(() => []),
    ])
      .then(([issueRows, returnRows, firmRows, projectRows, storeRows]) => {
        if (!active) return;
        setIssues(issueRows);
        setReturns(returnRows);
        setFirms(firmRows);
        setProjects(projectRows);
        setStores(storeRows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const firmNameById = useMemo(() => new Map(firms.map((f) => [f.id, f.name])), [firms]);
  const storeNameById = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const projectIdsWithRows = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of issues) {
      if (tx.issueType !== 'Project') continue;
      const id = String(tx.projectId ?? '').trim();
      if (id) ids.add(id);
    }
    for (const tx of returns) {
      if (tx.returnType !== 'Project') continue;
      const id = String(tx.projectId ?? '').trim();
      if (id) ids.add(id);
    }
    return ids;
  }, [issues, returns]);

  const projectOptions = useMemo(
    () =>
      Array.from(projectIdsWithRows)
        .map((id) => ({ value: id, label: projects.find((p) => p.id === id)?.name || id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [projectIdsWithRows, projects]
  );

  const selectedProjectName = projectOptions.find((p) => p.value === selectedProjectId)?.label || '';

  const issueLines = useMemo<SummaryLine[]>(
    () =>
      !selectedProjectId
        ? []
        : issues
            .filter((tx) => tx.issueType === 'Project' && String(tx.projectId ?? '').trim() === selectedProjectId)
            .flatMap((tx) =>
              tx.items.map((it, index) => ({
                id: `${tx.id}-${index}`,
                date: txDate(tx.date),
                firm: firmNameById.get(tx.firmId) || tx.firmId || '-',
                issueTo: tx.issuedTo || selectedProjectName || '-',
                department: tx.department || '-',
                item: it.item || '-',
                qty: Number(it.quantity) || 0,
                remarks: it.remark || '',
              }))
            )
            .sort((a, b) => b.date.localeCompare(a.date) || a.firm.localeCompare(b.firm)),
    [issues, firmNameById, selectedProjectId, selectedProjectName]
  );

  const returnLines = useMemo<SummaryLine[]>(
    () =>
      !selectedProjectId
        ? []
        : returns
            .filter((tx) => tx.returnType === 'Project' && String(tx.projectId ?? '').trim() === selectedProjectId)
            .flatMap((tx) =>
              tx.items.map((it, index) => ({
                id: `${tx.id}-${index}`,
                date: txDate(tx.date),
                firm: firmNameById.get(tx.firmId) || tx.firmId || '-',
                department: tx.department || '-',
                storeName: tx.store || (tx.storeId ? storeNameById.get(tx.storeId) : '') || '-',
                receivedBy: tx.person || tx.approvedBy || '-',
                item: it.item || '-',
                qty: Number(it.quantity) || 0,
                remarks: it.remark || '',
              }))
            )
            .sort((a, b) => b.date.localeCompare(a.date) || a.firm.localeCompare(b.firm)),
    [returns, firmNameById, storeNameById, selectedProjectId]
  );

  const totalIssueQty = issueLines.reduce((sum, row) => sum + row.qty, 0);
  const totalReturnQty = returnLines.reduce((sum, row) => sum + row.qty, 0);
  const headerClass = 'px-3 py-2 border border-outline-variant bg-black text-[10px] font-bold uppercase tracking-wider';
  const headerStyle = { color: '#ffffff', opacity: 1 } as const;
  const cellClass = 'px-3 py-2 border border-outline-variant text-on-surface-variant align-top';

  const buildExportHtml = () => `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; }
          h1 { font-size: 16px; margin: 0 0 8px; }
          h2 { font-size: 13px; margin: 16px 0 8px; }
          p { font-size: 12px; margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
          th, td { border: 1px solid #000; padding: 6px; vertical-align: top; }
          th { background: #1d4ed8; color: #fff; text-transform: uppercase; font-size: 10px; }
          .num { text-align: right; white-space: nowrap; }
        </style>
      </head>
      <body>
        <h1>Summary - ${escapeHtml(selectedProjectName)}</h1>
        <p>Issue Qty: ${totalIssueQty} | Return Qty: ${totalReturnQty}</p>
        <h2>Issue</h2>
        <table>
          <thead><tr><th>Issue Date</th><th>Firm</th><th>Issue To</th><th>Department</th><th>Item</th><th class="num">Qty</th></tr></thead>
          <tbody>
            ${issueLines.length ? issueLines.map((r) => `<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.firm)}</td><td>${escapeHtml(r.issueTo)}</td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.item)}</td><td class="num">${r.qty}</td></tr>`).join('') : '<tr><td colspan="6">No issue rows found.</td></tr>'}
          </tbody>
        </table>
        <h2>Return</h2>
        <table>
          <thead><tr><th>Date</th><th>Firm</th><th>Department</th><th>Store Name</th><th>Received By</th><th>Item</th><th class="num">Qty</th><th>Remarks</th></tr></thead>
          <tbody>
            ${returnLines.length ? returnLines.map((r) => `<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.firm)}</td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.storeName)}</td><td>${escapeHtml(r.receivedBy)}</td><td>${escapeHtml(r.item)}</td><td class="num">${r.qty}</td><td>${escapeHtml(r.remarks || '-')}</td></tr>`).join('') : '<tr><td colspan="8">No return rows found.</td></tr>'}
          </tbody>
        </table>
      </body>
    </html>
  `.trim();

  const handleDownloadExcel = () => {
    if (!selectedProjectId) return;
    const blob = new Blob([buildExportHtml()], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedProjectName.replace(/[^a-z0-9]+/gi, '_') || 'project'}_summary.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (!selectedProjectId) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(`<!doctype html>${buildExportHtml()}<script>window.onload = () => window.print();</script>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="p-4 border-b border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 flex-wrap">
          <div className="font-headline font-bold text-sm text-on-surface">Summary</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-[460px] max-w-[calc(100vw-220px)]">
              <SearchableSelect
                value={selectedProjectId}
                options={projectOptions}
                onChange={setSelectedProjectId}
                placeholder="Select Project..."
                allowClear
              />
            </div>
            <button type="button" className="btn btn-sm h-[38px] px-3 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleDownloadExcel} disabled={!selectedProjectId} title="Download Excel">
              <FileSpreadsheet size={16} className="mr-1" />
              Excel
            </button>
            <button type="button" className="btn btn-sm h-[38px] px-3 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleDownloadPdf} disabled={!selectedProjectId} title="Download PDF">
              <Download size={16} className="mr-1" />
              PDF
            </button>
          </div>
        </div>

        {!selectedProjectId ? (
          <div className="px-4 py-10 text-center text-sm text-on-surface-variant">
            Select a project to view issue and return summary.
          </div>
        ) : (
          <div className="p-4 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Issue Qty</div>
                <div className="text-lg font-semibold text-on-surface">{totalIssueQty}</div>
              </div>
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Return Qty</div>
                <div className="text-lg font-semibold text-on-surface">{totalReturnQty}</div>
              </div>
            </div>

            <section className="space-y-2">
              <div className="text-sm font-bold text-on-surface">Issue</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm border-2 border-outline-variant border-collapse">
                  <thead>
                    <tr>
                      <th className={headerClass} style={headerStyle}>Issue Date</th>
                      <th className={headerClass} style={headerStyle}>Firm</th>
                      <th className={headerClass} style={headerStyle}>Issue To</th>
                      <th className={headerClass} style={headerStyle}>Department</th>
                      <th className={headerClass} style={headerStyle}>Item</th>
                      <th className={`${headerClass} text-right`} style={headerStyle}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading || issueLines.length === 0 ? (
                      <tr><td colSpan={6} className={`${cellClass} text-center`}>{loading ? 'Loading...' : 'No issue rows found.'}</td></tr>
                    ) : issueLines.map((row) => (
                      <tr key={row.id}>
                        <td className={cellClass}>{formatDate(row.date)}</td>
                        <td className={cellClass}>{row.firm}</td>
                        <td className={cellClass}>{row.issueTo}</td>
                        <td className={cellClass}>{row.department}</td>
                        <td className={cellClass}>{row.item}</td>
                        <td className={`${cellClass} text-right font-semibold`}>{row.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-sm font-bold text-on-surface">Return</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm border-2 border-outline-variant border-collapse">
                  <thead>
                    <tr>
                      <th className={headerClass} style={headerStyle}>Date</th>
                      <th className={headerClass} style={headerStyle}>Firm</th>
                      <th className={headerClass} style={headerStyle}>Department</th>
                      <th className={headerClass} style={headerStyle}>Store Name</th>
                      <th className={headerClass} style={headerStyle}>Received By</th>
                      <th className={headerClass} style={headerStyle}>Item</th>
                      <th className={`${headerClass} text-right`} style={headerStyle}>Qty</th>
                      <th className={headerClass} style={headerStyle}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading || returnLines.length === 0 ? (
                      <tr><td colSpan={8} className={`${cellClass} text-center`}>{loading ? 'Loading...' : 'No return rows found.'}</td></tr>
                    ) : returnLines.map((row) => (
                      <tr key={row.id}>
                        <td className={cellClass}>{formatDate(row.date)}</td>
                        <td className={cellClass}>{row.firm}</td>
                        <td className={cellClass}>{row.department}</td>
                        <td className={cellClass}>{row.storeName}</td>
                        <td className={cellClass}>{row.receivedBy}</td>
                        <td className={cellClass}>{row.item}</td>
                        <td className={`${cellClass} text-right font-semibold`}>{row.qty}</td>
                        <td className={cellClass}>{row.remarks || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
