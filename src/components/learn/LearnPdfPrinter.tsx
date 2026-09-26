import React from 'react';
import { REAL_CASE_STUDIES } from '@/src/lib/learnData';

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

function openPrintWindow(html: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
