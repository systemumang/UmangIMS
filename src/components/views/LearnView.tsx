import React, { useState } from 'react';
import {
  Briefcase,
  Printer,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Target,
  FileText,
  Layers,
  GraduationCap,
} from 'lucide-react';
import { REAL_CASE_STUDIES, CaseStudy } from '@/src/lib/learnData';
import { triggerPrintCaseStudies } from '@/src/components/learn/LearnPdfPrinter';

export default function LearnView() {
  const [expandedCaseStudyId, setExpandedCaseStudyId] = useState<string | null>('cs-1');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Hero Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white p-8 shadow-xl border border-emerald-800">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-600/30 backdrop-blur border border-emerald-400/30 rounded-xl">
              <GraduationCap className="w-8 h-8 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-400/30">
                  Practical Practice & Onboarding
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-1">
                IMS Real Case Studies
              </h1>
            </div>
          </div>

          <p className="text-slate-300 max-w-3xl text-sm md:text-base leading-relaxed">
            Practice each feature of IMS with real-world industrial scenarios. These step-by-step case studies cover all permutations and combinations—from purchase requisitions and supplier rate comparisons to partial deliveries, quality rejections, direct POs, and inter-site stock transfers.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-emerald-700/50">
            <div className="flex items-center gap-2 text-xs text-emerald-200">
              <Briefcase className="w-4 h-4 text-emerald-400" />
              <span><strong className="text-white font-semibold">{REAL_CASE_STUDIES.length}</strong> End-to-End Real World Scenarios</span>
            </div>

            <button
              type="button"
              onClick={triggerPrintCaseStudies}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-all hover:scale-[1.02] active:scale-95"
            >
              <Printer size={15} />
              <span>Download / Print Case Studies PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Case Studies Cards List */}
      <div className="space-y-6">
        {REAL_CASE_STUDIES.map((cs) => {
          const isExpanded = expandedCaseStudyId === cs.id;
          return (
            <div
              key={cs.id}
              className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all duration-200 hover:border-slate-300"
            >
              {/* Header Row */}
              <div
                onClick={() => setExpandedCaseStudyId(isExpanded ? null : cs.id)}
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-200"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {cs.complexity} Level
                    </span>
                    <span className="text-xs text-slate-500 font-medium">⏱ Est. Duration: {cs.duration}</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{cs.title}</h3>
                  <p className="text-xs text-slate-600">{cs.industryScenario}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-xs font-semibold text-emerald-700 hidden md:inline">
                    {isExpanded ? 'Hide Details' : 'View Workflow'}
                  </span>
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </div>
                </div>
              </div>

              {/* Detailed Breakdown */}
              {isExpanded && (
                <div className="p-6 space-y-6 bg-slate-50/40">
                  {/* Objective & Given Parameters */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-2xs space-y-2">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Target size={14} className="text-emerald-600" />
                        Objective
                      </h4>
                      <p className="text-xs text-slate-700 leading-relaxed">{cs.objective}</p>
                    </div>

                    <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-2xs space-y-2">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText size={14} className="text-blue-600" />
                        Given Scenario Data
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {Object.entries(cs.givenData).map(([k, v]) => (
                          <div key={k} className="bg-slate-50 p-2 border border-slate-200 rounded">
                            <span className="font-semibold text-slate-700 block text-[11px]">{k}:</span>
                            <span className="text-slate-900 font-mono text-[11px]">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Workflow Table */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                      <Layers size={14} className="text-emerald-600" />
                      Step-by-Step Execution Workflow
                    </h4>

                    <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white shadow-2xs">
                      <table className="w-full text-xs text-left text-slate-700">
                        <thead className="bg-slate-100 text-slate-900 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                          <tr>
                            <th className="p-3 w-1/6">Phase</th>
                            <th className="p-3 w-1/4">Action Required</th>
                            <th className="p-3 w-1/5">IMS Module</th>
                            <th className="p-3 w-1/4">Key Decision / Logic</th>
                            <th className="p-3 w-1/5">Expected Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {cs.workflowSteps.map((w, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/80">
                              <td className="p-3 font-bold text-slate-900 bg-slate-50/50">{w.phase}</td>
                              <td className="p-3">{w.actionRequired}</td>
                              <td className="p-3 font-mono text-[11px] text-blue-700 bg-blue-50/30 font-semibold">{w.systemModule}</td>
                              <td className="p-3 text-slate-800">{w.keyDecision}</td>
                              <td className="p-3 font-medium text-emerald-800 bg-emerald-50/30">{w.expectedOutcome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Permutations Covered */}
                  <div className="flex items-center gap-2 flex-wrap pt-2">
                    <span className="text-xs font-bold text-slate-600">Permutations & Rules Covered:</span>
                    {cs.permutationsCovered.map((perm, idx) => (
                      <span
                        key={idx}
                        className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
