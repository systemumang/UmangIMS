export interface LearnModule {
  id: string;
  number: number;
  title: string;
  category: 'Masters' | 'Procurement' | 'Inventory' | 'Finance' | 'Reports';
  summary: string;
  estimatedTime: string;
  keyConcepts: string[];
  steps: {
    stepNumber: number;
    title: string;
    description: string;
    proTip?: string;
    fieldsToNote?: string[];
  }[];
  commonMistakes: string[];
}

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

export interface PracticeExercise {
  id: string;
  title: string;
  category: string;
  difficulty: 'Basic' | 'Medium' | 'Hard';
  description: string;
  scenario: string;
  questions: {
    id: string;
    questionText: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
    practicalActionHint: string;
  }[];
  practicalChallenge: {
    instructions: string[];
    expectedResultsChecklist: string[];
  };
}

export const LEARN_MODULES: LearnModule[] = [
  {
    id: 'mod-1',
    number: 1,
    title: 'Master Data Configuration & Setup',
    category: 'Masters',
    summary: 'Master data forms the backbone of IMS. Learn how to configure Suppliers, Items, Categories, Units, Projects, Departments, Priorities, and Document Sequences.',
    estimatedTime: '20 mins',
    keyConcepts: ['Suppliers & MSME status', 'Item Master & Reorder Levels', 'Taxation & HSN Codes', 'Multi-Project & Department Mapping'],
    steps: [
      {
        stepNumber: 1,
        title: 'Supplier Master & Bank Setup',
        description: 'Navigate to Masters -> Suppliers. Register vendor details including GSTIN, GST Type (Registered / Unregistered / Composition), MSME classification (Micro/Small/Medium with Certificate upload), Bank A/C details, and default Payment Terms.',
        fieldsToNote: ['GSTIN Format Verification', 'MSME Certificate Attachment', 'Payment Terms (e.g. Net 30, 50% Advance)', 'Bank IFC & Account Number'],
        proTip: 'Accurate GSTIN and State selection ensure automatic CGST+SGST vs IGST calculations across all POs and Invoices.',
      },
      {
        stepNumber: 2,
        title: 'Item Master & Reorder Rules',
        description: 'Navigate to Masters -> Items. Define unique item codes, names, categories, default Unit of Measurement (UOM), GST rate, and Reorder Level for automated stock alerts.',
        fieldsToNote: ['Item Name & Specification', 'UOM (e.g., Kg, Pcs, Mtr)', 'GST % (5%, 12%, 18%, 28%)', 'Reorder Level Threshold'],
        proTip: 'Set realistic Reorder Levels so the system triggers alerts in the Fast/Slow Moving Reports before stockouts occur.',
      },
      {
        stepNumber: 3,
        title: 'Projects & Departments Configuration',
        description: 'Navigate to Masters -> Projects & Departments. Set up active project sites (e.g. Site Alpha, Factory Unit 2) and departmental cost centers (e.g. Civil, Electrical, Maintenance).',
        fieldsToNote: ['Project Short Name', 'Site Address', 'Department Head', 'Budget Center'],
      },
      {
        stepNumber: 4,
        title: 'Document Sequences Setup',
        description: 'Navigate to Settings -> Doc Sequences. Define custom numbering formats for PRs, POs, GRNs, Invoices, Issues, Transfers, and Credit Vouchers with financial year prefixes (e.g. PR/2026-27/0001).',
        fieldsToNote: ['Prefix', 'Next Sequence Number', 'Suffix', 'Reset Cycle'],
      },
    ],
    commonMistakes: [
      'Creating duplicate Supplier entries with slight name spelling differences.',
      'Selecting wrong GST Type for out-of-state vendors causing tax miscalculations.',
      'Omitting Reorder Levels on critical raw materials.',
    ],
  },
  {
    id: 'mod-2',
    number: 2,
    title: 'Purchase Requisition (PR) & Material Request Workflow',
    category: 'Procurement',
    summary: 'Master the request-to-procure pipeline. Understand how site engineers raise PRs, attach specifications, specify priorities, and route them for departmental approval.',
    estimatedTime: '25 mins',
    keyConcepts: ['Site Material Request vs External PR', 'Urgent vs Normal Priority', 'PR Approval Queue', 'Stock Availability Verification'],
    steps: [
      {
        stepNumber: 1,
        title: 'Creating a New Purchase Requisition',
        description: 'Navigate to Requisitions -> New Purchase Request (or Material -> Request Material). Select Project, Department, Delivery Date, and Request Priority.',
        fieldsToNote: ['Project Name', 'Required By Date', 'Priority (Urgent / Normal / High)', 'Remarks / Specification'],
      },
      {
        stepNumber: 2,
        title: 'Adding Items & Specifications',
        description: 'Search and select items from Catalogue. Input required quantity, target price (if known), detailed technical specifications, and attach technical drawings or site photos if needed.',
        fieldsToNote: ['Item Code & Description', 'Requested Qty', 'Item Remarks', 'Media Links / Files'],
        proTip: 'Detailed item remarks save time during Quotation and PO creation by eliminating vendor back-and-forth.',
      },
      {
        stepNumber: 3,
        title: 'Routing through Pending Tasks (PR Approval)',
        description: 'Submitting a PR sends it to "Pending Tasks -> Approve PR". Authorised managers review stock in hand, verify urgency, approve, adjust quantities, or reject with comments.',
        fieldsToNote: ['Approval Status', 'Approved Quantity', 'Manager Comments'],
      },
    ],
    commonMistakes: [
      'Raising PRs for items that are already abundantly available in local site stock.',
      'Marking routine items as "Urgent" without justification.',
      'Leaving item technical specifications blank.',
    ],
  },
  {
    id: 'mod-3',
    number: 3,
    title: 'Quotation Management & Rate Comparison',
    category: 'Procurement',
    summary: 'Learn how to handle multi-vendor rate solicitations, input quotation responses, compare landed costs, and select winning bids transparently.',
    estimatedTime: '20 mins',
    keyConcepts: ['Pending Supplier Rate Queue', 'Landed Cost Calculation', 'Comparative Analysis', 'Supplier Lead Times'],
    steps: [
      {
        stepNumber: 1,
        title: 'Publishing RFQ to Pending Supplier Rate',
        description: 'Approved PRs move to Quotation -> Pending Supplier Rate. Select multiple qualified suppliers to send quotation queries.',
        fieldsToNote: ['Target Suppliers', 'Submission Deadline', 'Terms Requested'],
      },
      {
        stepNumber: 2,
        title: 'Entering Supplier Quotation Rates',
        description: 'In Quotation Master, record vendor quotes including Basic Unit Rate, Freight charges, Packing/Handling, GST extra/inclusive status, and promised delivery lead time.',
        fieldsToNote: ['Unit Rate', 'Discount %', 'Freight Amount', 'GST %', 'Delivery Time (Days)'],
      },
      {
        stepNumber: 3,
        title: 'Evaluating Comparative Matrix & Final Selection',
        description: 'Review the comparative statement generated by IMS. The system highlights L1 (Lowest Landed Cost). Approve L1 vendor or log justification if selecting L2 due to faster delivery.',
        fieldsToNote: ['Landed Cost per Unit', 'L1 Selection Indicator', 'Deviation Reason'],
        proTip: 'Always compare Landed Cost (Rate + Freight + Taxes) rather than just Basic Rate.',
      },
    ],
    commonMistakes: [
      'Comparing inclusive GST quotes with exclusive GST quotes directly.',
      'Ignoring freight and un-loading charges during comparative analysis.',
    ],
  },
  {
    id: 'mod-4',
    number: 4,
    title: 'Purchase Order (PO) Creation & Dispatch',
    category: 'Procurement',
    summary: 'Learn how to generate POs from approved PRs or Quotations, create Direct POs, handle supplier advances, check POs, and attach send proof.',
    estimatedTime: '30 mins',
    keyConcepts: ['PR-based PO vs Direct PO', 'PO Checking Queue', 'PO Dispatch Proof', 'Supplier Advance Integration'],
    steps: [
      {
        stepNumber: 1,
        title: 'Generating PO from PR or Direct PO',
        description: 'Navigate to Pending Tasks -> Create PO or click Direct PO. Select Supplier, Firm details, Project, Payment Terms, Shipping Terms, and delivery destination.',
        fieldsToNote: ['Supplier Name', 'Billing Firm', 'Shipping Address', 'Payment & Delivery Terms'],
      },
      {
        stepNumber: 2,
        title: 'Configuring Line Items & Advance Demands',
        description: 'Verify items, rates, GST, discounts, and item-wise remarks. If supplier mandates advance, check "Supplier Advance Required" and specify amount/percentage.',
        fieldsToNote: ['Unit Rate', 'GST Split (CGST/SGST/IGST)', 'Item Description', 'Advance Required Amount'],
      },
      {
        stepNumber: 3,
        title: 'Drafting, Checking & Finalizing PO',
        description: 'PO enters "Draft POs" -> "Check PO". Checker reviews terms, tax codes, and pricing. Once checked, status becomes Finalized.',
        fieldsToNote: ['Checked By User', 'Check Remarks', 'PO Status'],
      },
      {
        stepNumber: 4,
        title: 'Dispatching PO & Uploading Proof',
        description: 'In "Send PO" queue, download PO PDF, email/WhatsApp to vendor, and upload sent proof (email screenshot or WhatsApp receipt).',
        fieldsToNote: ['Sent Date', 'Sent Proof File / Link'],
        proTip: 'Attaching sent proof prevents vendor disputes regarding order placement dates.',
      },
    ],
    commonMistakes: [
      'Sending un-checked POs to suppliers.',
      'Selecting wrong billing firm resulting in incorrect GST state matching.',
      'Forgetting to flag required advance payment.',
    ],
  },
  {
    id: 'mod-5',
    number: 5,
    title: 'Goods Receipt Note (GRN), SRN & Quality Check',
    category: 'Inventory',
    summary: 'Master physical material receipt at site, partial GRN processing, Service Receipt Notes (SRN), and Quality Control inspection.',
    estimatedTime: '30 mins',
    keyConcepts: ['PO-based GRN', 'Service Receipt Note (SRN)', 'Partial vs Full Receipts', 'Quality Passed vs Rejected Stock'],
    steps: [
      {
        stepNumber: 1,
        title: 'Receiving Physical Goods (Create GRN)',
        description: 'Navigate to Pending Tasks -> Create GRN. Select PO Number. System auto-populates open line items and remaining pending quantities.',
        fieldsToNote: ['Challan / LR Number', 'Vehicle No', 'Received Quantity', 'Material Goods Delivered By'],
      },
      {
        stepNumber: 2,
        title: 'Service Receipt Notes (SRN)',
        description: 'For labor contracts, hiring, or maintenance services, use "Create SRN" queue to verify completed service work against PO milestones.',
        fieldsToNote: ['Service Period', 'Work Completed %', 'Measurement Sheet Ref'],
      },
      {
        stepNumber: 3,
        title: 'Quality Inspection (Check Quality Queue)',
        description: 'Receipts move to "Check Quality". QC Engineer inspects goods and inputs Accepted Qty vs Rejected Qty with rejection reasons.',
        fieldsToNote: ['Passed Quantity', 'Rejected Quantity', 'Quarantine Location', 'Defect Category'],
        proTip: 'Only Accepted Quantity updates usable inventory; rejected quantity stays in quarantine pending return or credit voucher.',
      },
    ],
    commonMistakes: [
      'Receiving excess quantity beyond PO limit without management override.',
      'Skipping QC step for critical construction components.',
      'Confusing GRN (Goods) with SRN (Services).',
    ],
  },
  {
    id: 'mod-6',
    number: 6,
    title: 'Invoicing, Credit Vouchers & Payments',
    category: 'Finance',
    summary: 'Understand vendor bill processing, GRN-Invoice 3-way matching, freight/extra charge GST splits, Credit Vouchers, and Tally accounting sync.',
    estimatedTime: '35 mins',
    keyConcepts: ['Enter Invoice & 3-Way Match', 'Extra Charges & GST', 'Credit Voucher / Debit Note', 'Tally Entry Queue'],
    steps: [
      {
        stepNumber: 1,
        title: 'Entering Vendor Invoice',
        description: 'Navigate to Pending Tasks -> Enter Invoice. Input Vendor Invoice Number, Invoice Date, and link corresponding GRN(s).',
        fieldsToNote: ['Vendor Invoice No', 'Invoice Date', 'Billed Amount', 'Linked GRN IDs'],
      },
      {
        stepNumber: 2,
        title: 'Adding Extra Charges & GST Allocation',
        description: 'Add extra charges (Freight, Loading, Packaging, Insurance) and specify whether GST applies to extra charges.',
        fieldsToNote: ['Extra Charge Type', 'Charge Amount', 'GST % on Charge'],
      },
      {
        stepNumber: 3,
        title: 'Handling Defect Adjustments (Credit Vouchers)',
        description: 'If vendor bills for rejected goods or overcharges, create a Credit Voucher in "Enter Credit Voucher" queue to reduce vendor payable.',
        fieldsToNote: ['Credit Voucher Amount', 'Tax Adjustment', 'Reason / Rejection Ref'],
      },
      {
        stepNumber: 4,
        title: 'Invoice Approval & Tally Entry Verification',
        description: 'Approver approves invoice in "Approve Invoice". Verified entries flow to "Tally Entry" queue for accounts team ledger posting.',
        fieldsToNote: ['Approval Status', 'Tally Voucher Ref', 'Tally Date'],
        proTip: '3-way matching (PO rate == Invoice rate, GRN qty == Billed qty) prevents overpayment errors.',
      },
    ],
    commonMistakes: [
      'Entering invoices without linking GRN, breaking 3-way match.',
      'Miscalculating GST on freight charges.',
      'Forgetting to adjust advance payments against final bill.',
    ],
  },
  {
    id: 'mod-7',
    number: 7,
    title: 'Stock Operations: Issues, Returns, Transfers & Damages',
    category: 'Inventory',
    summary: 'Learn how to manage physical warehouse inventory, issue material to projects, record returns, log damages, and transfer stock between sites.',
    estimatedTime: '25 mins',
    keyConcepts: ['Stock Issue to Project', 'Material Return to Store', 'Inter-Site Transfer Note', 'Damage & Scrap Logging'],
    steps: [
      {
        stepNumber: 1,
        title: 'Issuing Material to Project Site',
        description: 'Navigate to Stock -> Issue Master -> Add Issue. Select Project, Receiving Supervisor, and Item quantities issued from store.',
        fieldsToNote: ['Project Name', 'Issued To Person', 'Issue Slip No', 'Issued Quantity'],
      },
      {
        stepNumber: 2,
        title: 'Recording Unused Material Return',
        description: 'When excess items return from site to store, log in Stock -> Return Master. Stock automatically reinstates in main inventory.',
        fieldsToNote: ['Returning Project', 'Condition (Usable/Restock)', 'Returned Qty'],
      },
      {
        stepNumber: 3,
        title: 'Inter-Project Stock Transfer',
        description: 'Move stock directly from Project A to Project B via Stock -> Transfer Master. Generates Transfer Pass for gate exit.',
        fieldsToNote: ['From Project', 'To Project', 'Transporter Details', 'Transferred Qty'],
      },
      {
        stepNumber: 4,
        title: 'Logging Damaged or Expired Stock',
        description: 'Record broken, damaged, or expired materials in Stock -> Damage Master with write-off reason and photo proof.',
        fieldsToNote: ['Damage Date', 'Scrap Value', 'Root Cause Reason'],
      },
    ],
    commonMistakes: [
      'Issuing stock without an Issue Slip reference.',
      'Transferring items between sites without updating system Transfer Master.',
    ],
  },
  {
    id: 'mod-8',
    number: 8,
    title: 'Reports, Analytics & Courier Dispatch Tracking',
    category: 'Reports',
    summary: 'Utilize IMS reporting engines to monitor project consumption, expenses, fast/slow moving items, pending orders, and outward courier dispatches.',
    estimatedTime: '20 mins',
    keyConcepts: ['Projectwise Consumption', 'Fast vs Slow Moving Analysis', 'Pending Order Tracker', 'Courier Tracking'],
    steps: [
      {
        stepNumber: 1,
        title: 'Projectwise Material Consumption Summary',
        description: 'Navigate to Stock -> Projectwise Material Consumption Summary to analyze exact material expenses allocated per project.',
        fieldsToNote: ['Project Filter', 'Date Range', 'Total Cost Consumed'],
      },
      {
        stepNumber: 2,
        title: 'Fast & Slow Moving Item Analytics',
        description: 'Check Reports -> Fast Moving / Slow Moving Items to identify non-moving dead stock and high-turnover items needing safety stock.',
        fieldsToNote: ['Turnover Ratio', 'Days Since Last Issue', 'Stock Holding Value'],
      },
      {
        stepNumber: 3,
        title: 'Courier & Consignment Dispatch Log',
        description: 'Track outward documents, vendor PO hardcopies, or material samples via Courier Tracking -> Couriers & Pending Receipt.',
        fieldsToNote: ['Docket Number', 'Courier Partner', 'Dispatch Date', 'Delivery Status'],
      },
    ],
    commonMistakes: [
      'Ignoring slow-moving report alerts, leading to capital locked in obsolete items.',
    ],
  },
];

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

export const PRACTICE_EXERCISES: PracticeExercise[] = [
  {
    id: 'ex-1',
    title: 'Exercise 1: Fundamentals of Requisition & PO Workflow',
    category: 'Procurement Basics',
    difficulty: 'Basic',
    description: 'Test your understanding of raising Purchase Requisitions, handling approvals, and setting PO parameters.',
    scenario: 'You are the Site Engineer at "Highway Bypass Project". You need 100 meters of 4-inch PVC Pipes by next Friday.',
    questions: [
      {
        id: 'q1-1',
        questionText: 'Where in IMS should you navigate first to request 100m of PVC Pipes?',
        options: [
          'Stock -> Transfer Master',
          'Requisitions -> New Purchase Request',
          'Pending Tasks -> Enter Invoice',
          'Masters -> Suppliers',
        ],
        correctOptionIndex: 1,
        explanation: 'Material requirements start with a Purchase Request (PR) under Requisitions -> New Purchase Request.',
        practicalActionHint: 'Click on Requisitions -> New Purchase Request in the left menu.',
      },
      {
        id: 'q1-2',
        questionText: 'If the store already has 120m of PVC Pipes in stock, what should happen during PR approval?',
        options: [
          'Approve 100m PR anyway to stock up',
          'Store Manager can reject or issue directly from stock instead of purchasing',
          'System automatically deletes the item from item master',
          'Create a Direct PO without approval',
        ],
        correctOptionIndex: 1,
        explanation: 'Checking store inventory before approval avoids unnecessary spending and redundant inventory accumulation.',
        practicalActionHint: 'Review stock levels in Stock -> Inventory before approving PRs.',
      },
      {
        id: 'q1-3',
        questionText: 'Which detail is CRITICAL to specify on a PO to ensure correct tax calculation between out-of-state vendor and local site?',
        options: [
          'Driver phone number',
          'Supplier GSTIN and Billing Firm State',
          'Item color code',
          'Courier tracking docket',
        ],
        correctOptionIndex: 1,
        explanation: 'If Supplier State != Billing Firm State, IGST applies; if same state, CGST + SGST applies.',
        practicalActionHint: 'Verify GSTIN state code in Supplier Master before finalizing POs.',
      },
    ],
    practicalChallenge: {
      instructions: [
        'Open "Requisitions -> New Purchase Request" in demo mode.',
        'Select any active Project and Department.',
        'Add 1 Item with quantity 100.',
        'Save as Draft PR and observe it in "Pending Tasks -> Approve PR".',
      ],
      expectedResultsChecklist: [
        'PR Number generated with custom sequence prefix.',
        'PR status shows "Pending Approval".',
        'Item quantity matches entered value.',
      ],
    },
  },
  {
    id: 'ex-2',
    title: 'Exercise 2: 3-Way Matching, Extra Charges & Credit Vouchers',
    category: 'Finance & Invoicing',
    difficulty: 'Medium',
    description: 'Master vendor invoice validation, GRN linkage, extra freight charge handling, and Credit Voucher adjustments.',
    scenario: 'Supplier delivers goods worth ₹1,00,000. Invoice includes ₹5,000 freight charge. 10% of delivered items were rejected during Quality Inspection.',
    questions: [
      {
        id: 'q2-1',
        questionText: 'What is the "3-Way Match" rule enforced by IMS during Enter Invoice?',
        options: [
          'Matching Supplier Name, Driver Name, and Vehicle Number',
          'Matching PO Unit Rates, GRN Received Quantities, and Invoice Billed Values',
          'Matching 3 different supplier quotes',
          'Matching 3 payment installment receipts',
        ],
        correctOptionIndex: 1,
        explanation: '3-Way Match ensures you only pay for what was ordered (PO Rate) and actually accepted (GRN Qty).',
        practicalActionHint: 'Always link GRNs when entering vendor invoices.',
      },
      {
        id: 'q2-2',
        questionText: 'If 10% of goods were rejected during QC, how should the billing adjustment be handled?',
        options: [
          'Pay full invoice and ignore rejection',
          'Create a Credit Voucher / Debit Note for the rejected portion',
          'Delete the PO from database',
          'Change the item master GST rate',
        ],
        correctOptionIndex: 1,
        explanation: 'A Credit Voucher reduces the vendor payable ledger cleanly while maintaining audit trail for rejected stock.',
        practicalActionHint: 'Use "Pending Tasks -> Enter Credit Voucher" for defect adjustments.',
      },
      {
        id: 'q2-3',
        questionText: 'When adding ₹5,000 freight charge on an invoice, how should GST be treated if freight carries 18% tax?',
        options: [
          'Freight cannot have GST',
          'Select 18% GST on Extra Charges field so tax is split correctly',
          'Add ₹5,000 directly to item basic price without tax',
          'Subtract ₹5,000 from vendor payment',
        ],
        correctOptionIndex: 1,
        explanation: 'Extra charges like freight have their own GST percentage that must be added to total invoice tax.',
        practicalActionHint: 'Use Extra Charges section under Enter Invoice tab.',
      },
    ],
    practicalChallenge: {
      instructions: [
        'Navigate to "Pending Tasks -> Enter Invoice".',
        'Select a sample pending GRN.',
        'Add Freight Charge of ₹2,500 with 18% GST.',
        'Verify total invoice calculation.',
      ],
      expectedResultsChecklist: [
        'Tax calculation breaks down CGST, SGST, or IGST correctly.',
        'Extra charge added to net payable.',
        'Invoice moves to "Approve Invoice" queue.',
      ],
    },
  },
  {
    id: 'ex-3',
    title: 'Exercise 3: Inventory Control & Multi-Site Stock Management',
    category: 'Stock Operations',
    difficulty: 'Hard',
    description: 'Solve complex stock movement challenges including inter-site transfers, consumption tracking, and slow-moving stock identification.',
    scenario: 'You manage 3 construction sites. Site A has 500 safety helmets lying unused for 6 months (slow moving), while Site C needs 200 safety helmets immediately.',
    questions: [
      {
        id: 'q3-1',
        questionText: 'Which report in IMS helps you spot items that have been sitting unused in warehouse for months?',
        options: [
          'Doc Sequences Settings',
          'Reports -> Slow Moving Items',
          'Pending Supplier Rate',
          'Courier Tracking',
        ],
        correctOptionIndex: 1,
        explanation: 'The Slow Moving Items report identifies dead stock holding value and stagnant inventory.',
        practicalActionHint: 'Check Reports -> Slow Moving Items periodically.',
      },
      {
        id: 'q3-2',
        questionText: 'Instead of issuing a new PO for 200 helmets for Site C, what is the best IMS workflow action?',
        options: [
          'Scrap helmets at Site A and buy new ones',
          'Create an Inter-Site Transfer from Site A to Site C using Stock -> Transfer Master',
          'Raise an urgent PR for 200 new helmets',
          'Hide stock from Site A records',
        ],
        correctOptionIndex: 1,
        explanation: 'Inter-site stock transfers optimize existing capital and prevent redundant material purchases.',
        practicalActionHint: 'Use Stock -> Transfer Master to move items between projects.',
      },
      {
        id: 'q3-3',
        questionText: 'What happens to store inventory balance when an Issue Slip is posted in Stock -> Issue Master?',
        options: [
          'Inventory increases',
          'Inventory decreases for that item at the selected store and records project consumption',
          'Inventory remains unchanged',
          'Item is deleted from catalogue',
        ],
        correctOptionIndex: 1,
        explanation: 'Material Issue reduces physical store stock and charges the item cost to the project cost center.',
        practicalActionHint: 'Always post Issue Slips promptly when releasing goods to supervisors.',
      },
    ],
    practicalChallenge: {
      instructions: [
        'Open "Stock -> Transfer Master".',
        'Select From Project A and To Project B.',
        'Select an item and quantity to transfer.',
        'Verify stock balance update on Inventory View.',
      ],
      expectedResultsChecklist: [
        'Transfer Gate Pass generated.',
        'Source project stock reduced.',
        'Destination project stock increased.',
      ],
    },
  },
];
