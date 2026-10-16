import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Printer } from 'lucide-react';
import { REAL_CASE_STUDIES } from '@/src/lib/learnData';
import { triggerPrintCaseStudies } from '@/src/components/learn/LearnPdfPrinter';

const lessonTitles: Record<string, string> = {
  'cs-1': 'Cement purchase: request to payment',
  'cs-2': 'Emergency purchase & credit voucher',
  'cs-3': 'Stock transfer & damage write-off',
};

export default function LearnView() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const lesson = REAL_CASE_STUDIES.find((item) => item.id === activeId);
  const step = lesson?.workflowSteps[stepIndex];
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Learn IMS</h1>
          <p className="mt-1 text-sm text-slate-600">Practice everyday purchase workflows.</p>
        </div>
        <button type="button" onClick={triggerPrintCaseStudies} className={`${buttonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
          <Printer size={16} /> Download PDF
        </button>
      </header>

      {!lesson ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Choose a lesson to get started. Progress is kept while this view is open.</p>
          {REAL_CASE_STUDIES.map((item, index) => (
            <article key={item.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-2">
                <p className="text-sm text-slate-500">Lesson {index + 1} · {item.complexity} · {item.duration.replace(' scenario', '')}</p>
                <h2 className="text-lg font-semibold text-slate-900">{lessonTitles[item.id] || item.title}</h2>
                <p className="text-sm text-slate-600">{item.workflowSteps.length} guided steps</p>
                {completedIds.includes(item.id) && <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} /> Completed</p>}
              </div>
              <button type="button" onClick={() => { setActiveId(item.id); setStepIndex(0); }} className={`${buttonClass} shrink-0 bg-emerald-700 text-white hover:bg-emerald-800`}>
                {completedIds.includes(item.id) ? 'Review Lesson' : 'Start Learning'} <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <button type="button" onClick={() => setActiveId(null)} className={`${buttonClass} px-0 text-slate-600 hover:text-slate-900`}><ArrowLeft size={16} /> All lessons</button>
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 md:p-6">
            <div>
              <p className="mb-2 text-sm text-slate-500">{lesson.complexity} · {lesson.duration.replace(' scenario', '')}</p>
              <h2 className="text-xl font-semibold text-slate-900">{lessonTitles[lesson.id] || lesson.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-slate-700">{lesson.industryScenario}</p>
            </div>
            <details key={lesson.id} className="rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Scenario data & business rules</summary>
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <p><strong>Goal: </strong>{lesson.objective}</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(lesson.givenData).map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
                </dl>
                <div><p className="font-medium">Business rules covered</p><ul className="mt-2 list-disc space-y-1 pl-5">{lesson.permutationsCovered.map((rule) => <li key={rule}>{rule}</li>)}</ul></div>
              </div>
            </details>
          </section>

          {step ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 md:p-6" aria-label="Lesson steps">
              <div aria-live="polite" aria-atomic="true">
                <p className="text-sm font-medium text-emerald-700">Step {stepIndex + 1} of {lesson.workflowSteps.length}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={lesson.workflowSteps.length} aria-valuenow={stepIndex + 1}><div className="h-full rounded-full bg-emerald-600" style={{ width: `${((stepIndex + 1) / lesson.workflowSteps.length) * 100}%` }} /></div>
                <h3 className="mt-5 text-xl font-semibold text-slate-900">{step.phase.replace(/^\d+\.\s*/, '')}</h3>
                <dl className="mt-5 space-y-5 text-base leading-relaxed">
                  <div><dt className="font-semibold text-slate-900">Do this</dt><dd className="mt-1 text-slate-700">{step.actionRequired}</dd></div>
                  <div><dt className="font-semibold text-slate-900">Go to</dt><dd className="mt-1 text-emerald-800">{step.systemModule}</dd></div>
                  <div><dt className="font-semibold text-slate-900">Check</dt><dd className="mt-1 text-slate-700">{step.expectedOutcome}</dd></div>
                </dl>
                <details key={`${lesson.id}-${stepIndex}`} className="mt-5 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Decision to consider</summary><p className="mt-2 text-sm leading-relaxed text-slate-700">{step.keyDecision}</p></details>
              </div>
              <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-5">
                <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => value - 1)} className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40`}><ArrowLeft size={16} /> Previous</button>
                <button type="button" onClick={() => {
                  if (stepIndex === lesson.workflowSteps.length - 1) setCompletedIds((ids) => ids.includes(lesson.id) ? ids : [...ids, lesson.id]);
                  setStepIndex((value) => value + 1);
                }} className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}>{stepIndex === lesson.workflowSteps.length - 1 ? 'Finish Lesson' : 'Next Step'} <ArrowRight size={16} /></button>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center" aria-live="polite">
              <CheckCircle2 className="mx-auto text-emerald-700" size={32} />
              <h3 className="mt-3 text-xl font-semibold text-slate-900">Lesson complete</h3>
              <p className="mt-2 text-sm text-slate-600">You have reviewed all {lesson.workflowSteps.length} steps. Choose another lesson to keep learning.</p>
              <button type="button" onClick={() => setActiveId(null)} className={`${buttonClass} mt-5 bg-emerald-700 text-white hover:bg-emerald-800`}>Back to lessons <ArrowRight size={16} /></button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
