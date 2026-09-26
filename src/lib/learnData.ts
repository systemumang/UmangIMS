export interface CaseStudy {
  id: string;
  title: string;
  industryScenario: string;
  complexity: 'Beginner' | 'Intermediate' | 'Advanced';
  duration: string;
  objective: string;
  givenData: Record<string, string>;
  workflowSteps: {
    phase: string;
    actionRequired: string;
    systemModule: string;
    keyDecision: string;
    expectedOutcome: string;
  }[];
  permutationsCovered: string[];
}

export const REAL_CASE_STUDIES: CaseStudy[] = [
  {
    id: 'cs-1',
    title: 'Case Study 1: Complete Procurement Cycle for Cement Purchase (Site Alpha)',
    industryScenario: 'Construction Site Alpha urgently requires 500 bags of Portland Cement (PPC Grade) due to an upcoming roof slab casting schedule in 7 days.',
    complexity: 'Beginner',
    duration: '45 mins scenario',
    objective: 'Execute end-to-end purchasing from PR creation -> Quotation rate comparison -> PO generation -> Supplier advance -> Partial GRN -> Quality pass -> Invoice 3-way match -> Final payment.',
    givenData: {
      'Project': 'Site Alpha (Commercial Tower)',
      'Item': 'Portland Cement PPC 50kg Bag',
      'Required Qty': '500 Bags',
      'Selected Vendor': 'Ultratech Cement Dealers (GST Registered)',
      'Agreed Rate': '₹340 / Bag + 28% GST',
      'Freight': '₹2,000 lump sum',
      'Payment Term': '30% Advance, Balance on GRN within 15 Days',
    },
    workflowSteps: [
      {
        phase: '1. Requisition',
        actionRequired: 'Create PR for 500 bags of PPC Cement marked Urgent.',
        systemModule: 'Requisitions -> New Purchase Request',
        keyDecision: 'Verify existing store stock (currently 20 bags, insufficient for 500 bag slab requirement).',
        expectedOutcome: 'PR #PR/2026/0101 submitted and approved by Store Manager.',
      },
      {
        phase: '2. Quotation',
        actionRequired: 'Input rates from 2 suppliers: Supplier A @ ₹350/bag inclusive, Supplier B @ ₹340/bag + freight.',
        systemModule: 'Quotation -> Pending Supplier Rate',
        keyDecision: 'Compare landed costs: Supplier B total = ₹1,70,000 + ₹47,600 GST + ₹2,000 freight = ₹2,19,600 (L1 winner).',
        expectedOutcome: 'Supplier B selected in Comparative Statement.',
      },
      {
        phase: '3. Purchase Order',
        actionRequired: 'Create PO for Supplier B. Specify 30% Advance requirement (₹65,880).',
        systemModule: 'Pending Tasks -> Create PO & Check PO',
        keyDecision: 'Ensure advance flag is toggled on so accounts team receives advance payment alert.',
        expectedOutcome: 'PO #PO/2026/0402 checked and dispatched with sent proof.',
      },
      {
        phase: '4. Delivery & GRN',
        actionRequired: 'Truck arrives with 300 bags (First lot partial delivery).',
        systemModule: 'Pending Tasks -> Create GRN',
        keyDecision: 'Enter Challan No. LR-9982, received qty 300 bags. Pending balance remains 200 bags on PO.',
        expectedOutcome: 'GRN #GRN/2026/0881 generated for 300 bags.',
      },
      {
        phase: '5. Quality Inspection',
        actionRequired: 'QC team inspects bags for lump formation and moisture.',
        systemModule: 'Pending Tasks -> Check Quality',
        keyDecision: '295 bags passed, 5 bags rejected due to moisture damage.',
        expectedOutcome: '295 bags posted into usable stock; 5 bags moved to Quarantine.',
      },
      {
        phase: '6. Invoicing & Payment',
        actionRequired: 'Process vendor invoice for 300 bags billed @ ₹340/bag + prorated freight.',
        systemModule: 'Pending Tasks -> Enter Invoice & Link GRN',
        keyDecision: 'System deducts 30% advance previously paid and adjusts for 5 rejected bags.',
        expectedOutcome: 'Net payable calculated correctly and posted to Tally Entry queue.',
      },
    ],
    permutationsCovered: [
      'Multi-vendor rate comparison (Landed cost vs basic rate)',
      'Partial delivery handling (300 out of 500 bags)',
      'Quality rejection on GRN (5 bags rejected)',
      'Supplier advance deduction against partial invoice',
    ],
  },
  {
    id: 'cs-2',
    title: 'Case Study 2: Emergency Machinery Spare Part Procurement & Credit Voucher',
    industryScenario: 'Main Tower Crane at Factory Unit 2 suffers a hydraulic pump breakdown. Production is halted. Immediate direct procurement is required from a local unregistered dealer.',
    complexity: 'Intermediate',
    duration: '35 mins scenario',
    objective: 'Handle Direct PO bypass, Service SRN entry, vendor bill overcharge detection, and Credit Voucher generation.',
    givenData: {
      'Project': 'Factory Unit 2',
      'Item': 'Hydraulic Pump Assembly 250 Bar',
      'Required Qty': '2 Units',
      'Vendor': 'Local Industrial Hydraulics (Unregistered Vendor)',
      'Agreed Price': '₹45,000 / Unit (RCM Applicable)',
      'Invoice Overcharge': 'Vendor mistakenly billed ₹48,000 / Unit on Invoice',
    },
    workflowSteps: [
      {
        phase: '1. Direct PO',
        actionRequired: 'Create Direct PO bypassing PR stage due to emergency breakdown.',
        systemModule: 'Purchasing -> Direct PO',
        keyDecision: 'Set Vendor GST Type to "Unregistered" to trigger Reverse Charge Mechanism (RCM) tax rule.',
        expectedOutcome: 'Emergency Direct PO generated immediately.',
      },
      {
        phase: '2. Physical Receipt & QC',
        actionRequired: 'Both 2 hydraulic pumps delivered and installed.',
        systemModule: 'Pending Tasks -> Create GRN & QC',
        keyDecision: 'Both units tested on crane and approved 100%.',
        expectedOutcome: 'GRN passed with zero rejection.',
      },
      {
        phase: '3. Invoice Overcharge Detection',
        actionRequired: 'Vendor sends bill for ₹96,000 (billed at ₹48,000 each instead of PO rate ₹45,000).',
        systemModule: 'Pending Tasks -> Enter Invoice',
        keyDecision: '3-Way Match fails! System raises price variance flag of +₹6,000.',
        expectedOutcome: 'Invoice flagged for correction.',
      },
      {
        phase: '4. Credit Voucher Creation',
        actionRequired: 'Raise a Debit Note / Credit Voucher for ₹6,000 against Vendor to correct payable.',
        systemModule: 'Pending Tasks -> Enter Credit Voucher',
        keyDecision: 'Issue Credit Voucher #CV/2026/0012 linked to Invoice, reducing vendor balance to ₹90,000.',
        expectedOutcome: 'Vendor payable corrected cleanly without rejecting invoice.',
      },
    ],
    permutationsCovered: [
      'Emergency Direct PO execution',
      'Unregistered vendor RCM taxation',
      '3-Way Match price variance handling',
      'Credit Voucher / Debit Note issuance',
    ],
  },
  {
    id: 'cs-3',
    title: 'Case Study 3: Multi-Project Stock Transfer & Site Damage Write-Off',
    industryScenario: 'Project Beta is short on 12mm TMT Steel Bars, while Project Alpha has an excess surplus of 5 Tons. Transporter is hired to relocate materials.',
    complexity: 'Advanced',
    duration: '40 mins scenario',
    objective: 'Execute inter-site transfer, update consumption metrics, process transit damage, and generate stock summary reports.',
    givenData: {
      'Source Project': 'Project Alpha (Surplus Site)',
      'Destination Project': 'Project Beta (Deficit Site)',
      'Item': '12mm Fe500 TMT Steel Bars',
      'Transferred Qty': '5,000 Kg (5 Tons)',
      'Transit Damage': '150 Kg rusted and bent during open truck transit',
    },
    workflowSteps: [
      {
        phase: '1. Stock Verification',
        actionRequired: 'Check inventory balance at Project Alpha store.',
        systemModule: 'Stock -> Inventory',
        keyDecision: 'Confirm 8,500 Kg available in Project Alpha. Reserve 5,000 Kg for transfer.',
        expectedOutcome: 'Stock availability verified.',
      },
      {
        phase: '2. Transfer Note Generation',
        actionRequired: 'Issue Stock Transfer Pass from Project Alpha to Project Beta.',
        systemModule: 'Stock -> Transfer Master',
        keyDecision: 'Enter Transporter Name "Speed Freight Logistics", Vehicle No MH-04-CG-1102.',
        expectedOutcome: 'Transfer Document #ST/2026/0045 created. Alpha stock drops by 5,000 Kg.',
      },
      {
        phase: '3. Receiving & Damage Logging',
        actionRequired: 'Project Beta store receives shipment; discovers 150 Kg severely damaged.',
        systemModule: 'Stock -> Damage Master',
        keyDecision: 'Log 4,850 Kg into Project Beta usable stock; post 150 Kg in Damage Master under "Transit Loss".',
        expectedOutcome: 'Beta stock increases by 4,850 Kg; 150 Kg logged as transit damage.',
      },
      {
        phase: '4. Projectwise Summary Audit',
        actionRequired: 'Verify consumption and transfer totals across both projects.',
        systemModule: 'Stock -> Projectwise Material Consumption Summary',
        keyDecision: 'Ensure transfer costs are accurately re-allocated from Alpha cost center to Beta cost center.',
        expectedOutcome: 'Financial ledgers reflect updated project material valuations.',
      },
    ],
    permutationsCovered: [
      'Inter-site stock transfer note creation',
      'Transit damage & scrap logging',
      'Projectwise material cost re-allocation',
    ],
  },
];
