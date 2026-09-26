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
                            ? isCorrect
                              ? 'bg-emerald-50/50 border-emerald-300'
                              : 'bg-red-50/50 border-red-300'
                            : 'bg-slate-50/60 border-slate-200'
                        }`}
                      >
                        <div className="font-bold text-sm text-slate-900 mb-3 flex items-start gap-2">
                          <span className="bg-slate-200 text-slate-800 w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0">
                            {qIdx + 1}
                          </span>
                          <span>{q.questionText}</span>
                        </div>

                        <div className="space-y-2 ml-8">
                          {q.options.map((opt, optIdx) => {
                            const isThisSelected = selectedOpt === optIdx;
                            return (
                              <label
                                key={optIdx}
                                className={`flex items-center gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                                  isThisSelected
                                    ? 'bg-blue-50 border-blue-400 font-semibold text-blue-900 shadow-2xs'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/80'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={q.id}
                                  checked={isThisSelected}
                                  onChange={() => handleOptionSelect(q.id, optIdx)}
                                  className="text-blue-600 focus:ring-blue-500"
                                />
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>

                        <div className="mt-4 ml-8 flex items-center justify-between">
                          <button
                            type="button"
                            disabled={selectedOpt === undefined}
                            onClick={() => handleCheckQuestion(q.id)}
                            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-semibold shadow transition-all"
                          >
                            Check Answer
                          </button>

                          {isChecked && (
                            <span
                              className={`text-xs font-bold flex items-center gap-1 ${
                                isCorrect ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {isCorrect ? (
                                <>
                                  <Check size={16} /> Correct Choice!
                                </>
                              ) : (
                                <>
                                  <X size={16} /> Incorrect. Review explanation below.
                                </>
                              )}
                            </span>
                          )}
                        </div>

                        {isChecked && (
                          <div className="mt-4 ml-8 p-3 rounded-lg bg-white border border-slate-200 text-xs space-y-1.5">
                            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                              <Lightbulb size={14} className="text-amber-500" />
                              Explanation:
                            </div>
                            <p className="text-slate-600">{q.explanation}</p>
                            <div className="text-[11px] text-blue-700 font-medium">
                              🎯 <strong>Practical Action:</strong> {q.practicalActionHint}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Practical Challenge Checklist */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <Sparkles size={16} className="text-amber-500" />
                    Hands-On Practical Challenge Checklist
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="bg-white p-4 border border-slate-200 rounded-lg">
                      <strong className="block text-slate-800 font-bold mb-2">Step-by-step instructions in IMS:</strong>
                      <ol className="list-decimal pl-5 space-y-1.5 text-slate-700">
                        {ex.practicalChallenge.instructions.map((inst, idx) => (
                          <li key={idx}>{inst}</li>
                        ))}
                      </ol>
                    </div>

                    <div className="bg-white p-4 border border-slate-200 rounded-lg">
                      <strong className="block text-slate-800 font-bold mb-2">Expected Results Checkboxes:</strong>
                      <div className="space-y-2">
                        {ex.practicalChallenge.expectedResultsChecklist.map((checkText, idx) => {
                          const checkKey = `${ex.id}-check-${idx}`;
                          const isDone = completedChecklist[checkKey] || false;
                          return (
                            <label
                              key={idx}
                              className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition-all ${
                                isDone ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={() => handleToggleChecklist(checkKey)}
                                className="rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              <span>{checkText}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: PDF & PRINTABLE WORKBOOKS */}
      {activeTab === 'pdf' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Printer className="text-blue-600" size={20} />
                Download & Printable Training Manuals
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Export beautifully formatted, print-ready PDF workbooks for new employees, store managers, site engineers, and purchasing officers.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="border border-slate-200 rounded-xl p-5 bg-gradient-to-b from-blue-50/50 to-white flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                    <BookOpen size={20} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">Full Training Manual</h3>
                  <p className="text-xs text-slate-600">
                    Complete 8-module reference manual covering Masters, PRs, POs, GRNs, Invoices, Stock movements, and Reports.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={triggerPrintFullManual}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={15} />
                  Print / Save Full Manual PDF
                </button>
              </div>

              {/* Card 2 */}
              <div className="border border-slate-200 rounded-xl p-5 bg-gradient-to-b from-emerald-50/50 to-white flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Briefcase size={20} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">Real Case Studies Workbook</h3>
                  <p className="text-xs text-slate-600">
                    Industrial scenario workbook covering end-to-end purchasing, emergency Direct POs, transit damage, and credit notes.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={triggerPrintCaseStudies}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={15} />
                  Print Case Studies PDF
                </button>
              </div>

              {/* Card 3 */}
              <div className="border border-slate-200 rounded-xl p-5 bg-gradient-to-b from-amber-50/50 to-white flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Target size={20} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">Practice Exercises & Quiz</h3>
                  <p className="text-xs text-slate-600">
                    Staff testing workbook complete with questions, practical challenge instructions, and full answer keys.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={triggerPrintPracticeExercises}
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={15} />
                  Print Practice Workbook PDF
                </button>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
              <strong className="font-bold text-slate-900 block">💡 How to Save as PDF:</strong>
              <p>
                1. Click any button above to open the clean printable document in a new window.
                <br />
                2. Your browser&apos;s Print dialog will open automatically.
                <br />
                3. Under <strong>Destination</strong>, select <strong>&quot;Save as PDF&quot;</strong> instead of selecting a printer.
                <br />
                4. Click <strong>Save</strong> to download the PDF directly onto your device.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
