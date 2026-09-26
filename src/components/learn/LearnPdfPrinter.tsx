import React from 'react';
import { LEARN_MODULES, REAL_CASE_STUDIES, PRACTICE_EXERCISES } from '@/src/lib/learnData';

export function triggerPrintFullManual() {
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>IMS Complete Operating & Training Manual</title>
  <style>
    @media print {
      @page { margin: 15mm; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-after: always; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
      background: #ffffff;
    }
    .header {
      border-bottom: 3px solid #1e3a8a;
      padding-bottom: 15px;
      margin-bottom: 25px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { margin: 0; color: #1e3a8a; font-size: 26px; font-weight: 800; }
    .header p { margin: 5px 0 0 0; color: #64748b; font-size: 13px; }
    .badge {
      background: #dbeafe;
      color: #1e40af;
      padding: 4px 10px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
    }
    .module-card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 25px;
      background: #fff;
    }
    .module-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px;
    }
    .category-tag {
      display: inline-block;
      background: #0284c7;
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 3px;
      margin-right: 8px;
    }
    .summary { font-style: italic; color: #334155; margin-bottom: 15px; }
    .section-heading { font-weight: 700; font-size: 14px; color: #1e3a8a; text-transform: uppercase; margin-top: 15px; margin-bottom: 8px; }
    .step-list { list-style: none; padding-left: 0; }
    .step-item {
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      padding: 10px 15px;
      margin-bottom: 10px;
      border-radius: 0 6px 6px 0;
    }
    .step-title { font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .pro-tip {
      background: #fef3c7;
      border-left: 4px solid #d97706;
      padding: 8px 12px;
      font-size: 12px;
      color: #92400e;
      margin-top: 6px;
      border-radius: 0 4px 4px 0;
    }
    .mistake-box {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      padding: 10px 15px;
      border-radius: 6px;
      margin-top: 15px;
    }
    .mistake-box h4 { margin: 0 0 6px 0; color: #991b1b; font-size: 13px; text-transform: uppercase; }
    .mistake-box ul { margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 12px; }
    .toc {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .toc h3 { margin-top: 0; margin-bottom: 10px; font-size: 16px; color: #0f172a; }
    .toc ul { margin: 0; padding-left: 20px; }
    .toc li { margin-bottom: 5px; font-size: 13px; }
    .footer {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>IMS Inventory Management System</h1>
      <p>Comprehensive Feature Training & Operations Manual</p>
    </div>
    <span class="badge">Official Reference Guide</span>
  </div>

  <div class="toc">
    <h3>📖 Table of Contents</h3>
    <ul>
      ${LEARN_MODULES.map(
        (m) => `<li><strong>Module ${m.number}:</strong> ${m.title} <em>(${m.category} - ${m.estimatedTime})</em></li>`
      ).join('')}
    </ul>
  </div>

  ${LEARN_MODULES.map(
    (m) => `
    <div class="module-card">
      <div class="module-title">
        <span class="category-tag">${m.category}</span>
        Module ${m.number}: ${m.title}
      </div>
      <p class="summary">${m.summary}</p>
      
      <div class="section-heading">Key Concepts & Terms</div>
      <ul>
        ${m.keyConcepts.map((k) => `<li>${k}</li>`).join('')}
      </ul>

      <div class="section-heading">Step-by-Step Execution Protocol</div>
      <div class="step-list">
        ${m.steps
          .map(
            (s) => `
          <div class="step-item">
            <div class="step-title">Step ${s.stepNumber}: ${s.title}</div>
            <div>${s.description}</div>
            ${
              s.fieldsToNote && s.fieldsToNote.length > 0
                ? `<div style="font-size: 12px; margin-top: 6px; color: #475569;"><strong>Key Fields:</strong> ${s.fieldsToNote.join(', ')}</div>`
                : ''
            }
            ${s.proTip ? `<div class="pro-tip">💡 <strong>Pro Tip:</strong> ${s.proTip}</div>` : ''}
          </div>
        `
          )
          .join('')}
      </div>

      <div class="mistake-box">
        <h4>⚠️ Common Pitfalls to Avoid</h4>
        <ul>
          ${m.commonMistakes.map((cm) => `<li>${cm}</li>`).join('')}
        </ul>
      </div>
    </div>
  `
  ).join('')}

  <div class="footer">
    Inventory Management System (IMS) • Generated for Staff Operations & Printing • Confidential Internal Document
  </div>

  <script>window.onload = () => window.print();</script>
</body>
</html>
  `.trim();

  openPrintWindow(html);
}

export function triggerPrintCaseStudies() {
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>IMS Real Industrial Case Studies Workbook</title>
  <style>
    @media print {
      @page { margin: 15mm; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-after: always; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
    }
    .header {
      border-bottom: 3px solid #16a34a;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { margin: 0; color: #15803d; font-size: 24px; font-weight: 800; }
    .case-box {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 25px;
      background: #fff;
    }
    .case-title { font-size: 18px; font-weight: 700; color: #166534; margin-top: 0; margin-bottom: 10px; }
    .scenario-box {
      background: #f0fdf4;
      border-left: 4px solid #16a34a;
      padding: 12px 15px;
      margin-bottom: 15px;
      font-size: 13px;
      color: #14532d;
    }
    .data-table, .workflow-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 12px;
    }
    .data-table th, .data-table td, .workflow-table th, .workflow-table td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
    }
    .workflow-table th { background: #e2e8f0; color: #0f172a; font-weight: 700; }
    .perm-tag {
      display: inline-block;
      background: #f1f5f9;
      border: 1px solid #94a3b8;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      margin-right: 5px;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>IMS Real Industrial Case Studies</h1>
      <p>Hands-on Operational Workflows & Permutations Reference</p>
    </div>
  </div>

  ${REAL_CASE_STUDIES.map(
    (cs) => `
    <div class="case-box">
      <div class="case-title">${cs.title}</div>
      <div style="font-size: 12px; color: #475569; margin-bottom: 10px;">
        <strong>Complexity:</strong> ${cs.complexity} | <strong>Est. Duration:</strong> ${cs.duration}
      </div>

      <div class="scenario-box">
        <strong>🏢 Industry Scenario:</strong> ${cs.industryScenario}
        <br/><br/>
        <strong>🎯 Objective:</strong> ${cs.objective}
      </div>

      <h4 style="margin-bottom: 8px; font-size: 13px; color: #1e293b;">📋 Given Scenario Parameters</h4>
      <table class="data-table">
        ${Object.entries(cs.givenData)
          .map(([k, v]) => `<tr><th style="width: 30%; background: #f8fafc;">${k}</th><td>${v}</td></tr>`)
          .join('')}
      </table>

      <h4 style="margin-bottom: 8px; font-size: 13px; color: #1e293b;">🔄 Execution Phase Matrix</h4>
      <table class="workflow-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Required System Action</th>
            <th>IMS Module</th>
            <th>Key Decision / Logic</th>
            <th>Expected System Result</th>
          </tr>
        </thead>
        <tbody>
          ${cs.workflowSteps
            .map(
              (w) => `
            <tr>
              <td><strong>${w.phase}</strong></td>
              <td>${w.actionRequired}</td>
              <td><code>${w.systemModule}</code></td>
              <td>${w.keyDecision}</td>
              <td>${w.expectedOutcome}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <h4 style="margin-bottom: 6px; font-size: 12px; color: #475569;">🔀 Permutations & Edge Cases Covered:</h4>
      <div>
        ${cs.permutationsCovered.map((p) => `<span class="perm-tag">✔ ${p}</span>`).join('')}
      </div>
    </div>
  `
  ).join('')}

  <script>window.onload = () => window.print();</script>
</body>
</html>
  `.trim();

  openPrintWindow(html);
}

export function triggerPrintPracticeExercises() {
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>IMS Practice Exercises & Quiz Answer Key</title>
  <style>
    @media print {
      @page { margin: 15mm; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
    }
    .header {
      border-bottom: 3px solid #d97706;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .header h1 { margin: 0; color: #b45309; font-size: 24px; font-weight: 800; }
    .exercise-card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 25px;
    }
    .q-box {
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .opt-list { margin: 6px 0; padding-left: 20px; font-size: 12px; }
    .answer-key {
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 8px 12px;
      font-size: 12px;
      color: #166534;
      margin-top: 6px;
      border-radius: 4px;
    }
    .challenge-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      padding: 12px;
      border-radius: 6px;
      margin-top: 15px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>IMS Staff Practice Workbook & Answer Key</h1>
    <p>Testing Operational Readiness & System Feature Mastery</p>
  </div>

  ${PRACTICE_EXERCISES.map(
    (ex) => `
    <div class="exercise-card">
      <h3 style="margin-top: 0; color: #1e3a8a;">${ex.title} (${ex.category} - ${ex.difficulty})</h3>
      <p style="font-size: 13px; color: #334155;"><strong>Scenario:</strong> ${ex.scenario}</p>

      <h4>Questions & Detailed Solutions</h4>
      ${ex.questions
        .map(
          (q, idx) => `
        <div class="q-box">
          <strong>Q${idx + 1}: ${q.questionText}</strong>
          <ol class="opt-list" type="A">
            ${q.options
              .map(
                (opt, oIdx) => `
              <li style="${oIdx === q.correctOptionIndex ? 'font-weight: bold; color: #16a34a;' : ''}">
                ${opt} ${oIdx === q.correctOptionIndex ? ' ✔ (Correct Answer)' : ''}
              </li>
            `
              )
              .join('')}
          </ol>
          <div class="answer-key">
            💡 <strong>Explanation:</strong> ${q.explanation}
            <br/>
            🎯 <strong>IMS Action Hint:</strong> ${q.practicalActionHint}
          </div>
        </div>
      `
        )
        .join('')}

      <div class="challenge-box">
        <strong>🧪 Hands-On Practical Challenge:</strong>
        <ul>
          ${ex.practicalChallenge.instructions.map((i) => `<li>${i}</li>`).join('')}
        </ul>
        <strong>Verification Checklist:</strong>
        <ul>
          ${ex.practicalChallenge.expectedResultsChecklist.map((c) => `<li>[ ] ${c}</li>`).join('')}
        </ul>
      </div>
    </div>
  `
  ).join('')}

  <script>window.onload = () => window.print();</script>
</body>
</html>
  `.trim();

  openPrintWindow(html);
}

function openPrintWindow(html: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
