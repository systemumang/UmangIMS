import express from 'express';
import {
  approveInvoice,
  createInvoice,
  createFirm,
  createItemName,
  createItemManual,
  createPoFromPr,
  createRequest,
	  createGrn,
	  createSpecification,
	  createSpecificationValue,
	  createStore,
	  createUser,
	  createSupplier,
	  deleteFirm,
	  deleteItem,
	  deleteItemName,
	  deleteSpecification,
	  deleteSpecificationValue,
	  deleteStore,
	  deleteUser,
	  deleteSupplier,
	  decidePr,
	  exportWorkflowWorkbookBuffer,
		  getPr,
		  getPo,
		  getPoMeta,
		  getWorkflow,
		  listFirms,
	  listUsers,
		  listItemNames,
		  listItems,
		  listPosByPrId,
		  listSpecificationValues,
		  listSpecifications,
		  listStores,
	  listSuppliers,
	  payInvoice,
	  readRequests,
	  recordQc,
	  saveExcelSnapshotToDisk,
	  saveMastersExcelSnapshotToDisk,
	  exportMastersWorkbookBuffer,
	  upsertLogistics,
	  updateFirm,
	  updateItemManual,
	  updateItemName,
	  updateSpecification,
	  updateSpecificationValue,
	  updateStore,
			  updateUser,
			  updateSupplier,
			} from './sqliteStore';
	import { generatePurchaseRequisitionPdfBuffer } from './prPdf';
	import { generatePurchaseOrderPdfBuffer } from './poPdf';

export function createApiApp() {
  const app = express();
  app.use(express.json());

  function sendError(res: express.Response, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: message });
  }

  async function bestEffortSnapshot() {
    try {
      await saveExcelSnapshotToDisk();
    } catch {
      // ignore snapshot errors to avoid blocking core workflow
    }
    try {
      await saveMastersExcelSnapshotToDisk();
    } catch {
      // ignore snapshot errors to avoid blocking core workflow
    }
  }

  app.get('/firms', async (_req, res) => {
    try {
      res.json({ firms: await listFirms() });
    } catch (e) {
      sendError(res, e);
    }
  });

	  app.get('/requests', async (_req, res) => {
	    try {
	      res.json({ requests: await readRequests() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

		  // NOTE: Keep this route BEFORE `/requests/:id` so the JSON route doesn't capture `.pdf` downloads.
		  app.get('/requests/:id.pdf', async (req, res) => {
		    try {
		      const id = String(req.params.id ?? '').trim();
	      if (!id) return res.status(400).json({ error: 'Missing PR id' });
	      const request = await getPr(id);
	      if (!request) return res.status(404).json({ error: 'Not found' });
	      const firmName = (await listFirms()).find((f) => f.id === request.pr.firmId)?.name ?? request.pr.firmId;
	      const { buffer, filename } = await generatePurchaseRequisitionPdfBuffer({ request, firmName });
	      res.setHeader('Content-Type', 'application/pdf');
	      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	      res.status(200).send(buffer);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/requests/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '');
	      const pr = await getPr(id);
	      if (!pr) return res.status(404).json({ error: 'Not found' });
	      res.json({ request: pr });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/requests/:id/pos', async (req, res) => {
	    try {
	      const prId = String(req.params.id ?? '').trim();
	      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
	      res.json({ pos: await listPosByPrId(prId) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

  app.post('/requests', async (req, res) => {
    try {
      const firmId = String(req.body?.firmId ?? '').trim();
      const department = String(req.body?.department ?? '').trim();
      const requestedBy = String(req.body?.requestedBy ?? '').trim();
      const requiredDate = String(req.body?.requiredDate ?? '').trim();
      const items = Array.isArray(req.body?.items) ? req.body.items : [];

      if (!firmId || !department || !requestedBy || !requiredDate) return res.status(400).json({ error: 'Missing fields' });
      if (!items.length) return res.status(400).json({ error: 'At least one item is required' });

      const normalizedItems = items
        .map((it: any) => ({
          item: String(it.item ?? '').trim(),
          quantity: Number(it.quantity ?? 0),
          specification: String(it.specification ?? '').trim(),
        }))
        .filter((it: any) => it.item && Number.isFinite(it.quantity) && it.quantity > 0 && it.specification);

      if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });

      const created = await createRequest({ firmId, department, requestedBy, requiredDate, items: normalizedItems });
      await bestEffortSnapshot();
      res.status(201).json({ request: created });
    } catch (e) {
      sendError(res, e);
    }
  });

	  app.post('/requests/:id/approve', async (req, res) => {
    const prId = String(req.params.id ?? '');
    const approver = String(req.body?.approver ?? '').trim() || 'Approver';
		    try {
		      const updated = await decidePr({ prId, decision: 'approve', approver });
		      await bestEffortSnapshot();
		      res.json({ request: updated });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.get('/pos/:id.pdf', async (req, res) => {
		    try {
		      const id = String(req.params.id ?? '').trim();
		      if (!id) return res.status(400).json({ error: 'Missing PO id' });
		      const po = await getPo(id);
		      if (!po) return res.status(404).json({ error: 'Not found' });
		      const meta = await getPoMeta(id);
		      const firmName = meta?.firmId ? (await listFirms()).find((f) => f.id === meta.firmId)?.name ?? meta.firmId : '';
		      const { buffer, filename } = await generatePurchaseOrderPdfBuffer({ po, firmName, orderDate: meta?.orderDate });
		      res.setHeader('Content-Type', 'application/pdf');
		      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		      res.status(200).send(buffer);
		    } catch (e) {
		      sendError(res, e);
		    }
		  });

			  app.post('/requests/:id/reject', async (req, res) => {
	    const prId = String(req.params.id ?? '');
	    const approver = String(req.body?.approver ?? '').trim() || 'Approver';
	    const rejectReason = String(req.body?.rejectReason ?? '').trim();
	    if (!rejectReason) return res.status(400).json({ error: 'Reject reason is required' });
			    try {
			      const updated = await decidePr({ prId, decision: 'reject', approver, rejectReason });
			      await bestEffortSnapshot();
			      res.json({ request: updated });
			    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/requests/:id/po', async (req, res) => {
    const prId = String(req.params.id ?? '');
    const supplier = String(req.body?.supplier ?? '').trim();
    const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!supplier || !paymentTerms || !items.length) return res.status(400).json({ error: 'Invalid payload' });

	    const normalizedItems = items
	      .map((it: any) => ({
	        itemId: String(it.itemId ?? '').trim(),
	        quantity: Number(it.quantity ?? 0),
	        rate: Number(it.rate ?? 0),
	      }))
	      .filter((it: any) => it.itemId && Number.isFinite(it.quantity) && it.quantity > 0 && Number.isFinite(it.rate) && it.rate >= 0);
	    if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });

		    try {
			      const po = await createPoFromPr({ prId, supplier, paymentTerms, items: normalizedItems });
		      await bestEffortSnapshot();
		      res.status(201).json({ po });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/pos/:id/invoice', async (req, res) => {
    const poId = String(req.params.id ?? '');
    const supplierInvoiceNo = String(req.body?.supplierInvoiceNo ?? '').trim();
    const invoiceDate = String(req.body?.invoiceDate ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!supplierInvoiceNo || !invoiceDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });

    const normalizedItems = items
      .map((it: any) => ({
        item: String(it.item ?? '').trim(),
        quantity: Number(it.quantity ?? 0),
        rate: Number(it.rate ?? 0),
      }))
      .filter((it: any) => it.item && Number.isFinite(it.quantity) && it.quantity > 0 && Number.isFinite(it.rate) && it.rate >= 0);

		    try {
		      const invoice = await createInvoice({ poId, supplierInvoiceNo, invoiceDate, items: normalizedItems });
		      await bestEffortSnapshot();
		      res.status(201).json({ invoice });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/invoices/:id/logistics', async (req, res) => {
    const invoiceId = String(req.params.id ?? '');
    const dispatchProof = String(req.body?.dispatchProof ?? '').trim();
    const cnOrCourierNo = String(req.body?.cnOrCourierNo ?? '').trim();
    const transporterName = String(req.body?.transporterName ?? '').trim();
    if (!dispatchProof || !cnOrCourierNo || !transporterName) return res.status(400).json({ error: 'Invalid payload' });
		    try {
		      const logistics = await upsertLogistics({ invoiceId, dispatchProof, cnOrCourierNo, transporterName });
		      await bestEffortSnapshot();
		      res.json({ logistics });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/invoices/:id/grn', async (req, res) => {
    const invoiceId = String(req.params.id ?? '');
    const receivedDate = String(req.body?.receivedDate ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!receivedDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });
    const normalizedItems = items
      .map((it: any) => ({
        item: String(it.item ?? '').trim(),
        quantityReceived: Number(it.quantityReceived ?? 0),
      }))
      .filter((it: any) => it.item && Number.isFinite(it.quantityReceived) && it.quantityReceived >= 0);
		    try {
		      const grn = await createGrn({ invoiceId, receivedDate, items: normalizedItems });
		      await bestEffortSnapshot();
		      res.status(201).json({ grn });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/grns/:id/qc', async (req, res) => {
    const grnId = String(req.params.id ?? '');
    const inspectedBy = String(req.body?.inspectedBy ?? '').trim();
    const location = String(req.body?.location ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!inspectedBy || !location || !items.length) return res.status(400).json({ error: 'Invalid payload' });
    const normalizedItems = items
      .map((it: any) => ({
        item: String(it.item ?? '').trim(),
        quantityAccepted: Number(it.quantityAccepted ?? 0),
        quantityRejected: Number(it.quantityRejected ?? 0),
        remarks: String(it.remarks ?? '').trim(),
      }))
      .filter((it: any) => it.item && Number.isFinite(it.quantityAccepted) && Number.isFinite(it.quantityRejected));
		    try {
		      const qc = await recordQc({ grnId, inspectedBy, location, items: normalizedItems });
		      await bestEffortSnapshot();
		      res.json(qc);
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/invoices/:id/approve', async (req, res) => {
    const invoiceId = String(req.params.id ?? '');
		    try {
		      const result = await approveInvoice(invoiceId);
		      await bestEffortSnapshot();
		      res.json(result);
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.post('/invoices/:id/pay', async (req, res) => {
    const invoiceId = String(req.params.id ?? '');
    const paymentDate = String(req.body?.paymentDate ?? '').trim();
    const amount = Number(req.body?.amount);
    const mode = String(req.body?.mode ?? '').trim();
    const referenceNo = String(req.body?.referenceNo ?? '').trim();
    if (!paymentDate || !Number.isFinite(amount) || !mode || !referenceNo) return res.status(400).json({ error: 'Invalid payload' });
		    try {
		      const payment = await payInvoice({ invoiceId, paymentDate, amount, mode, referenceNo });
		      await bestEffortSnapshot();
		      res.status(201).json({ payment });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

		  app.get('/workflow/:prId', async (req, res) => {
    const prId = String(req.params.prId ?? '');
		    try {
		      const workflow = await getWorkflow(prId);
		      res.json({ workflow });
		    } catch (e: any) {
		      res.status(404).json({ error: e?.message ?? String(e) });
		    }
		  });

	  app.get('/requests.xlsx', async (_req, res) => {
			    try {
			      const buf = await exportWorkflowWorkbookBuffer();
			      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
			      res.setHeader('Content-Disposition', 'attachment; filename="purchase_workflow.xlsx"');
			      res.status(200).send(buf);
			    } catch (e) {
			      sendError(res, e);
	    }
	  });

	  app.get('/masters.xlsx', async (_req, res) => {
	    try {
	      const buf = await exportMastersWorkbookBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="master_data.xlsx"');
      res.status(200).send(buf);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Masters
  app.get('/masters/firms', async (_req, res) => {
    try {
      res.json({ firms: await listFirms() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/firms', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const firm = await createFirm({ name, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ firm });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/firms/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const firm = await updateFirm({ id, name, updatedBy });
      await bestEffortSnapshot();
      res.json({ firm });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/firms/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteFirm({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/stores', async (_req, res) => {
    try {
      res.json({ stores: await listStores() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/stores', async (req, res) => {
    try {
      const firmId = String(req.body?.firmId ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const location = req.body?.location != null ? String(req.body.location) : undefined;
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const store = await createStore({ firmId, name, location, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ store });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/stores/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const firmId = String(req.body?.firmId ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const location = req.body?.location != null ? String(req.body.location) : undefined;
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const store = await updateStore({ id, firmId, name, location, updatedBy });
      await bestEffortSnapshot();
      res.json({ store });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/stores/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteStore({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/users', async (_req, res) => {
    try {
      res.json({ users: await listUsers() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/users', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const email = String(req.body?.email ?? '').trim();
      const designation = String(req.body?.designation ?? '').trim();
      const password = String(req.body?.password ?? '');
      const mobile = req.body?.mobile != null ? String(req.body.mobile) : undefined;
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const user = await createUser({ name, email, designation, password, mobile, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ user });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/users/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const email = String(req.body?.email ?? '').trim();
      const designation = String(req.body?.designation ?? '').trim();
      const password = req.body?.password != null ? String(req.body.password) : undefined;
      const mobile = req.body?.mobile != null ? String(req.body.mobile) : undefined;
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const user = await updateUser({ id, name, email, designation, password, mobile, updatedBy });
      await bestEffortSnapshot();
      res.json({ user });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/users/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteUser({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/suppliers', async (_req, res) => {
    try {
      res.json({ suppliers: await listSuppliers() });
    } catch (e) {
      sendError(res, e);
    }
  });

	  app.post('/masters/suppliers', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber) : undefined;
	      const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms) : undefined;
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const supplier = await createSupplier({ name, gstNumber, paymentTerms, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ supplier });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/suppliers/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber) : undefined;
	      const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms) : undefined;
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const supplier = await updateSupplier({ id, name, gstNumber, paymentTerms, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ supplier });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

  app.delete('/masters/suppliers/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteSupplier({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/item-names', async (_req, res) => {
    try {
      res.json({ itemNames: await listItemNames() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/item-names', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const category = req.body?.category != null ? String(req.body.category) : undefined;
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const itemName = await createItemName({ name, category, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ itemName });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/item-names/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const category = req.body?.category != null ? String(req.body.category) : undefined;
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const itemName = await updateItemName({ id, name, category, updatedBy });
      await bestEffortSnapshot();
      res.json({ itemName });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/item-names/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteItemName({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/specifications', async (_req, res) => {
    try {
      res.json({ specifications: await listSpecifications() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/specifications', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const specification = await createSpecification({ name, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ specification });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/specifications/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const specification = await updateSpecification({ id, name, updatedBy });
      await bestEffortSnapshot();
      res.json({ specification });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/specifications/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteSpecification({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/specification-values', async (req, res) => {
    try {
      const specificationId = String(req.query?.specificationId ?? '').trim();
      if (!specificationId) return res.status(400).json({ error: 'specificationId is required' });
      res.json({ specificationValues: await listSpecificationValues(specificationId) });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/specification-values', async (req, res) => {
    try {
      const specificationId = String(req.body?.specificationId ?? '').trim();
      const value = String(req.body?.value ?? '').trim();
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const specificationValue = await createSpecificationValue({ specificationId, value, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ specificationValue });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/specification-values/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const specificationId = String(req.body?.specificationId ?? '').trim();
      const value = String(req.body?.value ?? '').trim();
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const specificationValue = await updateSpecificationValue({ id, specificationId, value, updatedBy });
      await bestEffortSnapshot();
      res.json({ specificationValue });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/specification-values/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteSpecificationValue({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/masters/items', async (_req, res) => {
    try {
      res.json({ items: await listItems() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/items', async (req, res) => {
    try {
      const itemNameId = String(req.body?.itemNameId ?? '').trim();
      const unit = req.body?.unit != null ? String(req.body.unit) : undefined;
      const description = req.body?.description != null ? String(req.body.description) : undefined;
      const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';

      const item = await createItemManual({ itemNameId, unit, description, specs, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ item });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/items/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const itemNameId = String(req.body?.itemNameId ?? '').trim();
      const unit = req.body?.unit != null ? String(req.body.unit) : undefined;
      const description = req.body?.description != null ? String(req.body.description) : undefined;
      const specs = Array.isArray(req.body?.specs) ? req.body.specs : [];
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';

      const item = await updateItemManual({ id, itemNameId, unit, description, specs, updatedBy });
      await bestEffortSnapshot();
      res.json({ item });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/items/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteItem({ id, deletedBy });
      await bestEffortSnapshot();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Excel snapshot (saves under /data)
  app.post('/excel/snapshot', async (_req, res) => {
    try {
      const result = await saveExcelSnapshotToDisk();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Masters-only Excel snapshot (saves under /data)
  app.post('/excel/masters-snapshot', async (_req, res) => {
    try {
      const result = await saveMastersExcelSnapshotToDisk();
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  return app;
}
