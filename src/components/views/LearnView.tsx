import React, { useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Printer,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Lightbulb,
  FileText,
  Sparkles,
  HelpCircle,
  Target,
  ArrowRight,
  RotateCcw,
  Check,
  X,
  Clock,
  Layers,
} from 'lucide-react';
import {
  LEARN_MODULES,
  REAL_CASE_STUDIES,
  PRACTICE_EXERCISES,
  LearnModule,
  CaseStudy,
  PracticeExercise,
} from '@/src/lib/learnData';
import {
  triggerPrintFullManual,
  triggerPrintCaseStudies,
  triggerPrintPracticeExercises,
} from '@/src/components/learn/LearnPdfPrinter';

type TabKey = 'modules' | 'casestudies' | 'exercises' | 'pdf';

export default function LearnView() {
  const [activeTab, setActiveTab] = useState<TabKey>('modules');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>('mod-1');
  const [expandedCaseStudyId, setExpandedCaseStudyId] = useState<string | null>('cs-1');

  // Exercise interactive state
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [checkedQuestions, setCheckedQuestions] = useState<Record<string, boolean>>({});
  const [completedChecklist, setCompletedChecklist] = useState<Record<string, boolean>>({});

  const categories = ['All', 'Masters', 'Procurement', 'Inventory', 'Finance', 'Reports'];

  const filteredModules = LEARN_MODULES.filter(
    (m) => selectedCategory === 'All' || m.category === selectedCategory
  );

  const handleOptionSelect = (qId: string, optIdx: number) => {
    setUserAnswers((prev) => ({ ...prev, [qId]: optIdx }));
  };

  const handleCheckQuestion = (qId: string) => {
    setCheckedQuestions((prev) => ({ ...prev, [qId]: true }));
  };

  const handleToggleChecklist = (checkId: string) => {
    setCompletedChecklist((prev) => ({ ...prev, [checkId]: !prev[checkId] }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Hero Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-8 shadow-xl border border-blue-800">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600/30 backdrop-blur border border-blue-400/30 rounded-xl">
              <GraduationCap className="w-8 h-8 text-blue-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 px-2.5 py-0.5 rounded-full border border-blue-400/30">
                  Staff Onboarding & Training
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-1">
                IMS Learning & Practice Hub
              </h1>
            </div>
          </div>

          <p className="text-slate-300 max-w-3xl text-sm md:text-base leading-relaxed">
            Master every feature, operational workflow, and edge-case scenario of the Inventory Management System. Walk through feature modules, practice with real industrial case studies, and export printable training manuals.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-blue-700/50">
            <div className="flex items-center gap-6 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span><strong className="text-white font-semibold">8</strong> Operational Modules</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <span><strong className="text-white font-semibold">3</strong> Real Case Studies</span>
              </div>
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                <span><strong className="text-white font-semibold">3</strong> Practice Workbooks</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={triggerPrintFullManual}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition-all hover:scale-[1.02] active:scale-95"
              >
                <Printer size={15} />
                <span>Download / Print Manual PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-slate-200 bg-white rounded-xl shadow-sm p-1.5 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('modules')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'modules'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <BookOpen size={16} />
          <span>1. Feature Modules ({LEARN_MODULES.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('casestudies')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'casestudies'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Briefcase size={16} />
          <span>2. Real Case Studies ({REAL_CASE_STUDIES.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('exercises')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'exercises'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Target size={16} />
          <span>3. Interactive Practice Exercises</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pdf')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'pdf'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Printer size={16} />
          <span>4. PDF & Printable Workbooks</span>
        </button>
      </div>

      {/* TAB 1: FEATURE MODULES */}
      {activeTab === 'modules' && (
        <div className="space-y-6">
          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs font-semibold text-slate-500 mr-2">Category Filter:</span>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Module List */}
          <div className="space-y-4">
            {filteredModules.map((mod) => {
              const isExpanded = expandedModuleId === mod.id;
              return (
                <div
                  key={mod.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200 hover:border-slate-300"
                >
                  <div
                    onClick={() => setExpandedModuleId(isExpanded ? null : mod.id)}
                    className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-sm shadow-sm">
                        M{mod.number}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {mod.category}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                            <Clock size={12} />
                            {mod.estimatedTime}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 mt-1">{mod.title}</h3>
                        <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">{mod.summary}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-blue-600 hidden md:inline">
                        {isExpanded ? 'Collapse Details' : 'View Instructions'}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 p-6 bg-slate-50/50 space-y-6">
                      {/* Summary & Key Concepts */}
                      <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 text-xs text-blue-900 space-y-2">
                        <div className="font-bold flex items-center gap-1.5 text-blue-900 text-sm">
                          <Sparkles size={16} className="text-blue-600" />
                          Overview & Key Concepts
                        </div>
                        <p className="leading-relaxed">{mod.summary}</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {mod.keyConcepts.map((concept, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 bg-white rounded border border-blue-200 font-semibold text-[11px] text-blue-800 shadow-2xs"
                            >
                              ✓ {concept}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Step-by-Step Instructions */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                          <Layers size={14} />
                          Step-by-Step Execution Protocol
                        </h4>

                        <div className="space-y-3">
                          {mod.steps.map((step) => (
                            <div
                              key={step.stepNumber}
                              className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                                  Step {step.stepNumber}
                                </span>
                                <span className="text-sm font-bold text-slate-900 flex-1 ml-3">
                                  {step.title}
                                </span>
                              </div>

                              <p className="text-xs text-slate-700 leading-relaxed pl-1">
                                {step.description}
                              </p>

                              {step.fieldsToNote && step.fieldsToNote.length > 0 && (
                                <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 flex flex-wrap gap-1 items-center">
                                  <span className="font-semibold text-slate-800">Fields to Note:</span>
                                  {step.fieldsToNote.map((f, i) => (
                                    <span key={i} className="bg-white border border-slate-300 px-1.5 py-0.5 rounded font-mono text-[10px]">
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {step.proTip && (
                                <div className="bg-amber-50 border-l-4 border-amber-500 p-2.5 rounded-r text-xs text-amber-900 flex items-start gap-2">
                                  <Lightbulb size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                  <div>
                                    <strong className="font-semibold">Pro Tip:</strong> {step.proTip}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Common Mistakes */}
                      <div className="bg-red-50/80 border border-red-200 rounded-xl p-4 text-xs text-red-900 space-y-2">
                        <div className="font-bold flex items-center gap-2 text-red-800 text-xs uppercase tracking-wider">
                          <AlertCircle size={16} className="text-red-600" />
                          Common Pitfalls & Mistakes to Avoid
                        </div>
                        <ul className="list-disc pl-5 space-y-1 text-red-800 text-xs">
                          {mod.commonMistakes.map((mistake, idx) => (
                            <li key={idx}>{mistake}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: REAL CASE STUDIES */}
      {activeTab === 'casestudies' && (
        <div className="space-y-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <strong className="font-bold text-sm block">Industrial Case Studies for Practical Practice</strong>
                Each case study simulates real factory and construction site operational scenarios covering edge-cases like partial deliveries, quality rejections, direct POs, and inter-site transfers.
              </div>
            </div>

            <button
              type="button"
              onClick={triggerPrintCaseStudies}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded text-xs shadow transition-all shrink-0 ml-4 flex items-center gap-1.5"
            >
              <Printer size={14} />
              Print Case Studies Workbook
            </button>
          </div>

          <div className="space-y-6">
            {REAL_CASE_STUDIES.map((cs) => {
              const isExpanded = expandedCaseStudyId === cs.id;
              return (
                <div key={cs.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div
                    onClick={() => setExpandedCaseStudyId(isExpanded ? null : cs.id)}
                    className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-200"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {cs.complexity}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">⏱ {cs.duration}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-1">{cs.title}</h3>
                      <p className="text-xs text-slate-600 mt-0.5">{cs.industryScenario}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-emerald-700 hidden md:inline">
                        {isExpanded ? 'Hide Matrix' : 'View Workflow Matrix'}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-6 space-y-6 bg-slate-50/30">
                      {/* Objective & Given Parameters */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-2xs space-y-2">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            <Target size={14} className="text-emerald-600" />
                            Case Objective
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

                      {/* Workflow Matrix Table */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                          <Layers size={14} className="text-emerald-600" />
                          Execution Phase & Decision Matrix
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
                        <span className="text-xs font-bold text-slate-600">Permutations Covered in this Case Study:</span>
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
      )}

      {/* TAB 3: INTERACTIVE PRACTICE EXERCISES */}
      {activeTab === 'exercises' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <strong className="font-bold text-sm block">Interactive Quiz & Practical Challenges</strong>
                Test your knowledge of IMS rules. Select answers for each scenario, click "Check Answer" to see explanations, and complete the practical step-by-step checklist.
              </div>
            </div>

            <button
              type="button"
              onClick={triggerPrintPracticeExercises}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded text-xs shadow transition-all shrink-0 ml-4 flex items-center gap-1.5"
            >
              <Printer size={14} />
              Print Exercise Workbook
            </button>
          </div>

          <div className="space-y-8">
            {PRACTICE_EXERCISES.map((ex) => (
              <div key={ex.id} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
                <div className="border-b border-slate-200 pb-4">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                      {ex.category} • {ex.difficulty}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mt-2">{ex.title}</h3>
                  <p className="text-xs text-slate-600 mt-1"><strong>Scenario:</strong> {ex.scenario}</p>
                </div>

                {/* Questions */}
                <div className="space-y-6">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Questions & Decision Verification
                  </h4>

                  {ex.questions.map((q, qIdx) => {
                    const selectedOpt = userAnswers[q.id];
                    const isChecked = checkedQuestions[q.id];
                    const isCorrect = selectedOpt === q.correctOptionIndex;

                    return (
                      <div
                        key={q.id}
                        className={`p-4 rounded-xl border transition-all ${
                          isChecked
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
