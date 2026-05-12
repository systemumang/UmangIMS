import React, { useEffect, useMemo, useState } from 'react';
import { Download, Calendar, Plus } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { avatarColorClass, getInitials, statusPillClass, type Firm, type PurchaseRequest } from '@/src/lib/purchaseRequests';
import { formatDateDDMMYYYY, formatDateDDMMYYYYOnly } from '@/src/lib/date';
import { formatPrNumber } from '@/src/lib/docNumbers';
import SearchableSelect from '@/src/components/common/SearchableSelect';
import Pagination from '@/src/components/common/Pagination';
import { downloadTextFile, toCsv } from '@/src/lib/csvFile';

import { motion } from 'motion/react';
			
export default function PurchaseTable({
  requests,
  firms,
  onSelectRequest,
  onAddPurchaseRequest,
  onExportExcel,
  showStatusFilter = true,
}: {
  requests: PurchaseRequest[];
  firms: Firm[];
  onSelectRequest?: (id: string) => void;
  onAddPurchaseRequest?: () => void;
	onExportExcel?: () => void;
  showStatusFilter?: boolean;
			}) {
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

	  const departmentOptions = useMemo(() => {
	    const set = new Set<string>();
	    for (const r of requests) {
	      const d = String(r.department ?? '').trim();
	      if (d) set.add(d);
	    }
	    return Array.from(set).sort((a, b) => a.localeCompare(b));
	  }, [requests]);

	  const statusFilterOptions = useMemo(
	    () => [
	      { value: '', label: 'All Statuses' },
	      { value: 'Pending Approval', label: 'Pending Approval' },
	      { value: 'Approved', label: 'Approved' },
	      { value: 'Rejected', label: 'Rejected' },
	    ],
	    []
	  );

	  const departmentFilterOptions = useMemo(
	    () => [{ value: '', label: 'All Depts' }, ...departmentOptions.map((d) => ({ value: d, label: d }))],
	    [departmentOptions]
	  );

	  const compactControlClass =
	    'w-full h-6 bg-transparent border-none rounded-none pl-0 pr-8 py-0 text-xs font-medium text-on-surface-variant outline-none focus:ring-0';

	  const firmNameById = useMemo(
	    () => Object.fromEntries(firms.map((f) => [f.id, String(f.sortName ?? '').trim() || f.name])),
	    [firms]
	  );

	  const filteredRequests = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    const list = requests.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (departmentFilter && r.department !== departmentFilter) return false;
      if (from || to) {
        const rd = r.requiredDate ? new Date(r.requiredDate) : null;
        if (!rd || Number.isNaN(rd.getTime())) return false;
        if (from && rd < from) return false;
        if (to) {
          const end = new Date(to);
          end.setHours(23, 59, 59, 999);
          if (rd > end) return false;
        }
      }
      return true;
    });

    return list
      .slice()
      .sort((a, b) => String(b.requisitionDate ?? '').localeCompare(String(a.requisitionDate ?? '')));
	  }, [dateFrom, dateTo, departmentFilter, requests, statusFilter]);

	  const pageSize = 20;
	  const [page, setPage] = useState(1);

	  useEffect(() => {
	    setPage(1);
	  }, [statusFilter, departmentFilter, dateFrom, dateTo]);

		  const pagedRequests = useMemo(() => {
		    const start = (page - 1) * pageSize;
		    return filteredRequests.slice(start, start + pageSize);
		  }, [filteredRequests, page, pageSize]);

      const exportCsv = () => {
        if (onExportExcel) return onExportExcel();
        const stamp = new Date().toISOString().slice(0, 10);
        const header = ['pr', 'firm', 'department', 'requestedBy', 'requisitionDate', 'requiredDate', 'status'];
        const rows = filteredRequests.map((r) => ({
          pr: formatPrNumber(r.prNumber ?? r.id),
          firm: firmNameById[r.firmId] ?? r.firmId,
          department: r.department ?? '',
          requestedBy: r.requestedBy ?? '',
          requisitionDate: formatDateDDMMYYYYOnly(r.requisitionDate),
          requiredDate: formatDateDDMMYYYYOnly(r.requiredDate),
          status: r.status ?? '',
        }));
        downloadTextFile(`purchase-requests-${stamp}.csv`, toCsv(header, rows), 'text/csv; charset=utf-8');
      };

			  return (
			    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-lowest p-4 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center gap-3">
              {showStatusFilter ? (
		            <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
		              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Status</label>
				              <SearchableSelect
				                className="w-[160px]"
				                options={statusFilterOptions}
				                value={statusFilter}
				                onChange={setStatusFilter}
				                placeholder="All Statuses"
				                controlClassName={compactControlClass}
				              />
			            </div>
              ) : null}
          <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Date Range</label>
            <div className="flex items-center gap-2 text-xs font-medium">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent border-none text-xs font-medium focus:ring-0 outline-none"
              />
              <span className="text-outline-variant">—</span>
	              <input
	                type="date"
	                value={dateTo}
	                onChange={(e) => setDateTo(e.target.value)}
	                className="bg-transparent border-none text-xs font-medium focus:ring-0 outline-none"
	              />
              <Calendar size={14} className="text-outline-variant" />
            </div>
          </div>
	          <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg">
	            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Department</label>
		            <SearchableSelect
		              className="w-[160px]"
		              options={departmentFilterOptions}
		              value={departmentFilter}
		              onChange={setDepartmentFilter}
		              placeholder="All Depts"
		              controlClassName={compactControlClass}
		            />
		          </div>
        </div>
		        <div className="flex items-center gap-2">
              <button type="button" onClick={onAddPurchaseRequest} className="btn-danger btn-sm" disabled={!onAddPurchaseRequest}>
                <Plus size={14} />
                Add Purchase Request
              </button>
			          <button
			            type="button"
			            onClick={exportCsv}
		            className="btn btn-sm"
			          >
			            <Download size={14} />
			            Export Excel
			          </button>
          {/* Advanced Filters removed for Purchase Requisitions */}
	        </div>
	      </div>

	      {/* Table */}
	      <div className="bg-surface-container-lowest rounded-xl tonal-shadow overflow-hidden border border-blue-600">
	        <div className="overflow-x-auto">
	          <table className="w-full text-left border-collapse">
	            <thead>
			              <tr className="bg-surface-container-low/50 border-b border-blue-600">
				                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">PR</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Firm</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Department</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Requested By</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Requisition Date</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Required Date</th>
			                <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest border border-blue-600">Status</th>
			              </tr>
	            </thead>
		            <tbody>
				              {pagedRequests.map((req, idx) => (
		                <motion.tr 
		                  key={req.id} 
	                  initial={{ opacity: 0, y: 10 }}
	                  animate={{ opacity: 1, y: 0 }}
	                  transition={{ delay: idx * 0.05 }}
	                  tabIndex={onSelectRequest ? 0 : -1}
	                  onClick={() => onSelectRequest?.(req.id)}
	                  onKeyDown={(e) => {
	                    if (!onSelectRequest) return;
	                    if (e.key === 'Enter' || e.key === ' ') onSelectRequest(req.id);
	                  }}
	                  className={cn(
	                    "hover:bg-surface-container/30 transition-colors group",
	                    onSelectRequest && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-inset",
	                    idx === 2 && "bg-surface-container-low/20"
		                  )}
		                >
			                  <td className="px-6 py-4 font-headline font-bold text-sm text-primary border border-blue-600">{formatPrNumber(req.prNumber ?? req.id)}</td>
		                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">
			                    {firmNameById[req.firmId] ?? req.firmId}
		                  </td>
		                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">{req.department}</td>
		                  <td className="px-6 py-4 border border-blue-600">
		                    <div className="flex items-center gap-3">
		                      <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold", avatarColorClass(req.requestedBy))}>
		                        {getInitials(req.requestedBy)}
		                      </div>
			                      <span className="text-sm font-medium text-on-surface">{req.requestedBy}</span>
			                    </div>
			                  </td>
				                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">{formatDateDDMMYYYYOnly(req.requisitionDate)}</td>
				                  <td className="px-6 py-4 text-sm text-on-surface-variant border border-blue-600">{formatDateDDMMYYYYOnly(req.requiredDate)}</td>
			                  <td className="px-6 py-4 border border-blue-600">
		                    <span className={cn(
		                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
		                      statusPillClass(req.status)
		                    )}>
		                      {req.status}
		                    </span>
	                  </td>
	                </motion.tr>
	              ))}
	            </tbody>
          </table>
        </div>

		        <div className="px-6 py-4 bg-surface-container-low/30 border-t border-blue-600">
		          <Pagination totalItems={filteredRequests.length} page={page} pageSize={pageSize} onPageChange={setPage} />
		        </div>
      </div>
    </div>
  );
}

