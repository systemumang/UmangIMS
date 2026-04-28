import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
		  approveInvoice,
		  createInvoice,
		  createDepartment,
		  createFirm,
			  createProject,
			  createItemName,
			  createUnit,
			  createItemCategory,
			  createItemManual,
				  createPoFromPr,
			  createRequest,
			  createGrn,
			  createGrnForPo,
			  createSpecification,
			  createSpecificationValue,
				  createStore,
				  createCustomer,
				  createUser,
				  createSupplier,
				  createTransporter,
		  deleteDepartment,
		  deleteFirm,
			  deleteProject,
			  deleteItem,
				  deleteItemName,
				  deleteUnit,
				  deleteItemCategory,
			  deleteSpecification,
			  deleteSpecificationValue,
				  deleteStore,
				  deleteCustomer,
				  deleteUser,
						  deleteSupplier,
				  deleteTransporter,
				  deleteInvoice,
		  decidePr,
		  exportWorkflowWorkbookBuffer,
				  getPendingInvoiceItems,
				  getPendingGrnItems,
				  getGrnInvoiceLinkSummary,
				  listGrnsByPoId,
				  listGrnsByPrId,
		  listPendingGrnPosByPrId,
		  listQcRecordsByPrId,
		  replaceQcForGrn,
		  deleteQcForGrn,
		  getPr,
				  getPo,
				  getPoMeta,
				  updatePo,
				  updatePoCheckAndSent,
				  deletePo,
					  getWorkflow,
					  listDepartments,
					  listFirms,
					  listProjects,
					  listCustomers,
					  getLastSupplierByItemIds,
					  listUsers,
					  listUnits,
					  listItemCategories,
					  listItemNames,
					  listItems,
			  listPosByPrId,
			  listSpecificationValues,
			  listSpecifications,
			  listStores,
			  listSuppliers,
					  listTransporters,
						  payInvoice,
							  setGrnInvoiceLinks,
							  listGrnItemInvoiceLinkSummaryByPrId,
							  getGrnItemInvoiceLinks,
							  listPendingGrnInvoiceLinksByGrnId,
							  setGrnItemInvoiceLinks,
							  updateInvoice,
						  updateInvoicePayment,
						  updateGrn,
				  readRequests,
					  recordQc,
					  saveExcelSnapshotToDisk,
				  saveMastersExcelSnapshotToDisk,
			  exportMastersWorkbookBuffer,
			  upsertLogistics,
			  listInvoicesByPrId,
			  updateFirm,
				  updateProject,
					  updateItemManual,
				  updateItemName,
				  updateUnit,
				  updateItemCategory,
			  updateDepartment,
			  updateSpecification,
				  updateSpecificationValue,
				  updateStore,
								  updateCustomer,
								  updateUser,
							  updateSupplier,
						  updateTransporter,
						  deleteGrn,
						  listQueueApprovePr,
						  listQueueCreatePo,
						  listQueueCheckPo,
						  listQueueSendPo,
						  listQueueCreateGrn,
						  listQueueQc,
						  listQueueEnterInvoice,
						  listQueueLinkInvoiceGrn,
						  listQueueApproveInvoice,
						  listQueuePayment,
						  listOperationsPr,
						  listOperationsPo,
						  listOperationsGrns,
						  listOperationsInvoices,
						  listOperationsPayments,
						  getOperationsPrDetail,
						  getOperationsPoDetail,
						  getOperationsGrnDetail,
						  getOperationsInvoiceDetail,
						  getOperationsPaymentDetail,
						  exportOperationsSheetBuffer,
						  upsertOpeningBalance,
						  listOpeningBalances,
						  getFirmInventorySheet,
						  } from './sqliteStore';

	import { generatePurchaseRequisitionPdfBuffer } from './prPdf';
	import { generatePurchaseOrderPdfBuffer } from './poPdf';

export function createApiApp() {
  const app = express();
  // Allow larger payloads (e.g., Firm logo stored as data URL for PDF embedding).
  app.use(express.json({ limit: '10mb' }));

  const uploadDir = path.join(process.cwd(), 'data', 'uploads');
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch {
    // ignore
  }
  app.use('/uploads', express.static(uploadDir));

	  function sendError(res: express.Response, e: unknown) {
	    const message = e instanceof Error ? e.message : String(e);
	    return res.status(400).json({ error: message });
	  }

	  app.post('/uploads', async (req, res) => {
	    try {
	      const fileNameRaw = req.body?.fileName != null ? String(req.body.fileName) : 'upload.bin';
	      const contentType = req.body?.contentType != null ? String(req.body.contentType) : '';
	      const base64 = req.body?.base64 != null ? String(req.body.base64) : '';
	      if (!base64.trim()) return res.status(400).json({ error: 'Missing file data' });

	      const safeBase = path.basename(fileNameRaw).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || 'upload.bin';
	      const extFromName = path.extname(safeBase).toLowerCase();
	      const extFromType =
	        contentType === 'application/pdf'
	          ? '.pdf'
	          : contentType === 'image/png'
	            ? '.png'
	            : contentType === 'image/jpeg'
	              ? '.jpg'
	              : '';
	      const ext = (extFromName || extFromType || '').toLowerCase();
	      const allowed = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
	      if (ext && !allowed.has(ext)) return res.status(400).json({ error: 'Unsupported file type' });

	      const buf = Buffer.from(base64, 'base64');
	      // 8MB decoded limit (JSON limit is 10mb, but base64 expands size).
	      if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 8MB)' });

	      const id = crypto.randomUUID();
	      const outExt = ext || '.bin';
	      const outName = `${Date.now()}-${id}${outExt}`;
	      const outPath = path.join(uploadDir, outName);
	      fs.writeFileSync(outPath, buf);

	      res.json({ url: `/api/uploads/${encodeURIComponent(outName)}`, fileName: outName });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

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

	  function parseQueueFilters(req: express.Request) {
	    const q = req.query?.q != null ? String(req.query.q).trim() : undefined;
	    const firmId = req.query?.firmId != null ? String(req.query.firmId).trim() : undefined;
	    const department = req.query?.department != null ? String(req.query.department).trim() : undefined;
	    const projectId = req.query?.projectId != null ? String(req.query.projectId).trim() : undefined;
	    const supplierId = req.query?.supplierId != null ? String(req.query.supplierId).trim() : undefined;
	    const from = req.query?.from != null ? String(req.query.from).trim() : undefined;
	    const to = req.query?.to != null ? String(req.query.to).trim() : undefined;
	    return { q, firmId, department, projectId, supplierId, from, to };
	  }

	  app.get('/queues/approve-pr', async (req, res) => {
	    try {
	      const rows = await listQueueApprovePr(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/create-po', async (req, res) => {
	    try {
	      const rows = await listQueueCreatePo(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/check-po', async (req, res) => {
	    try {
	      const rows = await listQueueCheckPo(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/send-po', async (req, res) => {
	    try {
	      const rows = await listQueueSendPo(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/create-grn', async (req, res) => {
	    try {
	      const rows = await listQueueCreateGrn(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/check-quality', async (req, res) => {
	    try {
	      const rows = await listQueueQc(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/enter-invoice', async (req, res) => {
	    try {
	      const rows = await listQueueEnterInvoice(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/link-invoice-grn', async (req, res) => {
	    try {
	      const rows = await listQueueLinkInvoiceGrn(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/approve-invoice', async (req, res) => {
	    try {
	      const rows = await listQueueApproveInvoice(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/queues/payment', async (req, res) => {
	    try {
	      const rows = await listQueuePayment(parseQueueFilters(req));
	      res.json({ rows });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

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

		  app.get('/requests/:id/invoices', async (req, res) => {
		    try {
		      const prId = String(req.params.id ?? '').trim();
		      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
		      res.json({ invoices: await listInvoicesByPrId(prId) });
		    } catch (e) {
		      sendError(res, e);
		    }
		  });

	  app.post('/requests', async (req, res) => {
	    try {
	      const firmId = String(req.body?.firmId ?? '').trim();
	      const requestTypeRaw = String(req.body?.requestType ?? '').trim();
	      const requestType = requestTypeRaw === 'Project' ? 'Project' : 'Stock';
	      const projectId = req.body?.projectId != null ? String(req.body.projectId).trim() : undefined;
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

	      const created = await createRequest({
	        firmId,
	        requestType,
	        projectId,
	        department,
	        requestedBy,
	        requiredDate,
	        items: normalizedItems,
	      });
	      await bestEffortSnapshot();
	      res.status(201).json({ request: created });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

		  app.post('/requests/:id/approve', async (req, res) => {
	    const prId = String(req.params.id ?? '');
	    const approver = String(req.body?.approver ?? '').trim() || 'Approver';
	    const items = Array.isArray(req.body?.items) ? req.body.items : undefined;
			    try {
			      const updated = await decidePr({ prId, decision: 'approve', approver, items });
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
			      const firm = meta?.firmId ? (await listFirms()).find((f) => f.id === meta.firmId) ?? null : null;
			      const firmName = firm?.name ?? (meta?.firmId ? meta.firmId : '');
			      const { buffer, filename } = await generatePurchaseOrderPdfBuffer({ po, firm, firmName, orderDate: meta?.orderDate });
			      res.setHeader('Content-Type', 'application/pdf');
			      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
			      res.status(200).send(buffer);
			    } catch (e) {
			      sendError(res, e);
				    }
				  });

				  app.put('/pos/:id', async (req, res) => {
				    try {
			      const poId = String(req.params.id ?? '').trim();
			      const supplierId = req.body?.supplierId != null ? String(req.body.supplierId).trim() : null;
			      const supplier = req.body?.supplier != null ? String(req.body.supplier).trim() : null;
			      const paymentTerms = String(req.body?.paymentTerms ?? '').trim();
			      const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress) : undefined;
			      const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions) : undefined;
			      const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : undefined;
			      const items = Array.isArray(req.body?.items) ? req.body.items : [];
			      if (!poId || !paymentTerms) return res.status(400).json({ error: 'Invalid payload' });

			      const normalizedItems = items
			        .map((it: any) => ({
			          itemId: String(it.itemId ?? '').trim(),
			          quantity: Number(it.quantity ?? 0),
			          rate: Number(it.rate ?? 0),
			          discountPercent: Number(it.discountPercent ?? 0),
			          taxPercent: Number(it.taxPercent ?? 0),
			        }))
				        .filter(
				          (it: any) =>
				            it.itemId &&
				            Number.isFinite(it.quantity) &&
				            it.quantity > 0 &&
				            Number.isFinite(it.rate) &&
				            it.rate >= 0 &&
				            Number.isFinite(it.discountPercent) &&
				            it.discountPercent >= 0 &&
				            it.discountPercent <= 100 &&
				            Number.isFinite(it.taxPercent) &&
				            it.taxPercent >= 0 &&
				            it.taxPercent <= 100
						      );
					    if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });

				      const po = await updatePo({
				        poId,
				        supplierId,
			        supplier,
			        paymentTerms,
			        shippingAddress,
			        termsConditions,
			        items: normalizedItems,
			        updatedBy,
			      });
			      await bestEffortSnapshot();
			      res.json({ po });
			    } catch (e) {
			      sendError(res, e);
			    }
				  });

						  app.put('/pos/:id/check-sent', async (req, res) => {
						    try {
						      const poId = String(req.params.id ?? '').trim();
						      if (!poId) return res.status(400).json({ error: 'Missing PO id' });

						      // IMPORTANT: preserve existing values when fields are omitted from payload.
						      // Use `undefined` for "not provided", and `null` for "explicitly clear".
						      const hasCheckPoUserId = req.body && typeof req.body === 'object' && 'checkPoUserId' in req.body;
						      const hasCheckPo = req.body && typeof req.body === 'object' && 'checkPo' in req.body;
						      const hasCheckDate = req.body && typeof req.body === 'object' && 'checkDate' in req.body;
						      const hasSentBy = req.body && typeof req.body === 'object' && 'sentBy' in req.body;
						      const hasSentDate = req.body && typeof req.body === 'object' && 'sentDate' in req.body;

						      const checkPoUserId = hasCheckPoUserId ? (req.body.checkPoUserId != null ? String(req.body.checkPoUserId).trim() : null) : undefined;
						      const checkPo = hasCheckPo ? Boolean(req.body.checkPo) : undefined;
						      const checkDate = hasCheckDate ? (req.body.checkDate != null ? String(req.body.checkDate).trim() : null) : undefined;
						      const sentBy = hasSentBy ? (req.body.sentBy != null ? String(req.body.sentBy).trim() : null) : undefined;
						      const sentDate = hasSentDate ? (req.body.sentDate != null ? String(req.body.sentDate).trim() : null) : undefined;
						      const sentProof =
						        req.body && typeof req.body === 'object' && 'sentProof' in req.body
						          ? req.body.sentProof != null
						            ? String((req.body as any).sentProof).trim()
						            : null
						          : undefined;
						      const updatedBy = req.body?.updatedBy != null ? String(req.body.updatedBy).trim() : undefined;

						      const po = await updatePoCheckAndSent({ poId, checkPo, checkPoUserId, checkDate, sentBy, sentDate, sentProof, updatedBy });
						      await bestEffortSnapshot();
						      res.json({ po });
						    } catch (e) {
						      sendError(res, e);
						    }
						  });

				  app.delete('/pos/:id', async (req, res) => {
				    try {
			      const poId = String(req.params.id ?? '').trim();
			      const deletedBy = req.body?.deletedBy != null ? String(req.body.deletedBy).trim() : 'Purchase Team';
			      if (!poId) return res.status(400).json({ error: 'Missing PO id' });
			      const result = await deletePo({ poId, deletedBy });
			      await bestEffortSnapshot();
			      res.json(result);
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
	    const shippingAddress = req.body?.shippingAddress != null ? String(req.body.shippingAddress) : undefined;
	    const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions) : undefined;
	    const items = Array.isArray(req.body?.items) ? req.body.items : [];
	    if (!supplier || !paymentTerms || !items.length) return res.status(400).json({ error: 'Invalid payload' });

		    const normalizedItems = items
		      .map((it: any) => ({
		        itemId: String(it.itemId ?? '').trim(),
		        quantity: Number(it.quantity ?? 0),
		        rate: Number(it.rate ?? 0),
		        discountPercent: Number(it.discountPercent ?? 0),
		        taxPercent: Number(it.taxPercent ?? 0),
		      }))
			      .filter(
			        (it: any) =>
			          it.itemId &&
			          Number.isFinite(it.quantity) &&
			          it.quantity > 0 &&
			          Number.isFinite(it.rate) &&
			          it.rate >= 0 &&
			          Number.isFinite(it.discountPercent) &&
			          it.discountPercent >= 0 &&
			          it.discountPercent <= 100 &&
			          Number.isFinite(it.taxPercent) &&
			          it.taxPercent >= 0 &&
			          it.taxPercent <= 100
			      );
		    if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });

			    try {
				      const po = await createPoFromPr({ prId, supplier, paymentTerms, shippingAddress, termsConditions, items: normalizedItems });
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
				    const invoiceAmount = req.body?.invoiceAmount ? Number(req.body.invoiceAmount) : undefined;
				    const courierCharge = req.body?.courierCharge != null && String(req.body.courierCharge).trim() !== '' ? Number(req.body.courierCharge) : undefined;
				    const packingCharge = req.body?.packingCharge != null && String(req.body.packingCharge).trim() !== '' ? Number(req.body.packingCharge) : undefined;
				    const labourCharge = req.body?.labourCharge != null && String(req.body.labourCharge).trim() !== '' ? Number(req.body.labourCharge) : undefined;
				    const otherCharge = req.body?.otherCharge != null && String(req.body.otherCharge).trim() !== '' ? Number(req.body.otherCharge) : undefined;
				    const chargesGstAmount =
				      req.body?.chargesGstAmount != null && String(req.body.chargesGstAmount).trim() !== '' ? Number(req.body.chargesGstAmount) : undefined;
				    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
			    const documentUrl = req.body?.documentUrl ? String(req.body.documentUrl).trim() : undefined;
		    const cnCopyUrl = req.body?.cnCopyUrl ? String(req.body.cnCopyUrl).trim() : undefined;
		    const ewayBillNumber = req.body?.ewayBillNumber ? String(req.body.ewayBillNumber).trim() : undefined;
		    const cnNumber = req.body?.cnNumber ? String(req.body.cnNumber).trim() : undefined;
		    const courierNumber = req.body?.courierNumber ? String(req.body.courierNumber).trim() : undefined;
		    const transporterName = req.body?.transporterName ? String(req.body.transporterName).trim() : undefined;
		    const items = Array.isArray(req.body?.items) ? req.body.items : [];
		    if (!supplierInvoiceNo || !invoiceDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });

			    const normalizedItems = items
			      .map((it: any) => ({
			        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
			        item: it.item != null ? String(it.item).trim() : undefined,
			        quantity: Number(it.quantity ?? 0),
			        rate: Number(it.rate ?? 0),
			        taxPercent: it.taxPercent != null && String(it.taxPercent).trim() !== '' ? Number(it.taxPercent) : 0,
			      }))
				      .filter(
				        (it: any) =>
				          (it.itemId || it.item) &&
				          Number.isFinite(it.quantity) &&
				          it.quantity > 0 &&
				          Number.isFinite(it.rate) &&
				          it.rate >= 0 &&
				          Number.isFinite(it.taxPercent) &&
				          it.taxPercent >= 0 &&
				          it.taxPercent <= 100
				      );
			    if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });
				    if (courierCharge != null && (!Number.isFinite(courierCharge) || courierCharge < 0)) return res.status(400).json({ error: 'Invalid Courier Charge' });
				    if (packingCharge != null && (!Number.isFinite(packingCharge) || packingCharge < 0)) return res.status(400).json({ error: 'Invalid Packing Charge' });
				    if (labourCharge != null && (!Number.isFinite(labourCharge) || labourCharge < 0)) return res.status(400).json({ error: 'Invalid Labour Charge' });
				    if (otherCharge != null && (!Number.isFinite(otherCharge) || otherCharge < 0)) return res.status(400).json({ error: 'Invalid Other Charge' });
				    if (chargesGstAmount != null && (!Number.isFinite(chargesGstAmount) || chargesGstAmount < 0))
				      return res.status(400).json({ error: 'Invalid GST on Charges amount' });

			    try {
				      const invoice = await createInvoice({ 
			            poId, 
				            supplierInvoiceNo, 
				            invoiceDate, 
				            invoiceAmount,
				            courierCharge,
				            packingCharge,
				            labourCharge,
				            otherCharge,
				            chargesGstAmount,
				            updatedBy,
				            documentUrl,
				            cnCopyUrl,
				            ewayBillNumber,
		            cnNumber,
		            courierNumber,
		            transporterName,
	            items: normalizedItems 
	          });
		      await bestEffortSnapshot();
		      res.status(201).json({ invoice });
		    } catch (e: any) {
		      sendError(res, e);
		    }
		  });

			  app.get('/pos/:id/pending-invoice-items', async (req, res) => {
			    try {
			      const poId = String(req.params.id ?? '').trim();
			      if (!poId) return res.status(400).json({ error: 'Missing PO id' });
			      const items = await getPendingInvoiceItems(poId);
			      res.json({ items });
			    } catch (e) {
			      sendError(res, e);
			    }
			  });

			  app.get('/pos/:id/pending-grn-items', async (req, res) => {
			    try {
			      const poId = String(req.params.id ?? '').trim();
			      if (!poId) return res.status(400).json({ error: 'Missing PO id' });
			      const items = await getPendingGrnItems(poId);
			      res.json({ items });
			    } catch (e) {
			      sendError(res, e);
			    }
			  });

					  app.post('/pos/:id/grn', async (req, res) => {
					    const poId = String(req.params.id ?? '').trim();
					    const receivedDate = String(req.body?.receivedDate ?? '').trim();
					    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
					    const materialReceivedBy = req.body?.materialReceivedBy != null ? String(req.body.materialReceivedBy).trim() : null;
					    const goodsCollectedBy = req.body?.goodsCollectedBy != null ? String(req.body.goodsCollectedBy).trim() : null;
					    const items = Array.isArray(req.body?.items) ? req.body.items : [];
					    if (!poId || !receivedDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });
				    const normalizedItems = items
				      .map((it: any) => ({
				        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
				        item: it.item != null ? String(it.item).trim() : undefined,
				        quantityReceived: Number(it.quantityReceived ?? 0),
				      }))
				      .filter((it: any) => (it.itemId || it.item) && Number.isFinite(it.quantityReceived) && it.quantityReceived >= 0);
					    try {
					      const grn = await createGrnForPo({ poId, receivedDate, updatedBy, materialReceivedBy, goodsCollectedBy, items: normalizedItems });
					      await bestEffortSnapshot();
					      res.status(201).json({ grn });
					    } catch (e: any) {
					      sendError(res, e);
					    }
					  });

				  app.get('/pos/:id/grns', async (req, res) => {
				    try {
				      const poId = String(req.params.id ?? '').trim();
				      if (!poId) return res.status(400).json({ error: 'Missing PO id' });
				      const grns = await listGrnsByPoId(poId);
				      res.json({ grns });
				    } catch (e) {
				      sendError(res, e);
				    }
				  });

					  app.get('/requests/:id/grns', async (req, res) => {
					    try {
					      const prId = String(req.params.id ?? '').trim();
					      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
					      const grns = await listGrnsByPrId(prId);
					      res.json({ grns });
					    } catch (e) {
					      sendError(res, e);
					    }
					  });

					  app.get('/requests/:id/pending-grn-pos', async (req, res) => {
					    try {
					      const prId = String(req.params.id ?? '').trim();
					      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
					      const pos = await listPendingGrnPosByPrId(prId);
					      res.json({ pos });
					    } catch (e) {
					      sendError(res, e);
					    }
					  });

					  app.get('/requests/:id/qc-records', async (req, res) => {
					    try {
					      const prId = String(req.params.id ?? '').trim();
					      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
					      const qc = await listQcRecordsByPrId(prId);
					      res.json({ qc });
					    } catch (e) {
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

				  app.put('/invoices/:id', async (req, res) => {
				    const invoiceId = String(req.params.id ?? '').trim();
					    const supplierInvoiceNo = String(req.body?.supplierInvoiceNo ?? '').trim();
						    const invoiceDate = String(req.body?.invoiceDate ?? '').trim();
						    const invoiceAmount = req.body?.invoiceAmount ? Number(req.body.invoiceAmount) : undefined;
						    const courierCharge = req.body?.courierCharge != null && String(req.body.courierCharge).trim() !== '' ? Number(req.body.courierCharge) : undefined;
						    const packingCharge = req.body?.packingCharge != null && String(req.body.packingCharge).trim() !== '' ? Number(req.body.packingCharge) : undefined;
						    const labourCharge = req.body?.labourCharge != null && String(req.body.labourCharge).trim() !== '' ? Number(req.body.labourCharge) : undefined;
						    const otherCharge = req.body?.otherCharge != null && String(req.body.otherCharge).trim() !== '' ? Number(req.body.otherCharge) : undefined;
						    const chargesGstAmount =
						      req.body?.chargesGstAmount != null && String(req.body.chargesGstAmount).trim() !== '' ? Number(req.body.chargesGstAmount) : undefined;
						    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
				    const items = Array.isArray(req.body?.items) ? req.body.items : [];
				    if (!invoiceId || !supplierInvoiceNo || !invoiceDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });

					    const normalizedItems = items
					      .map((it: any) => ({
					        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
					        item: it.item != null ? String(it.item).trim() : undefined,
					        quantity: Number(it.quantity ?? 0),
					        rate: Number(it.rate ?? 0),
					        taxPercent: it.taxPercent != null && String(it.taxPercent).trim() !== '' ? Number(it.taxPercent) : 0,
					      }))
					      .filter(
					        (it: any) =>
					          (it.itemId || it.item) &&
					          Number.isFinite(it.quantity) &&
					          it.quantity > 0 &&
					          Number.isFinite(it.rate) &&
					          it.rate >= 0 &&
					          Number.isFinite(it.taxPercent) &&
					          it.taxPercent >= 0 &&
					          it.taxPercent <= 100
					      );
					    if (!normalizedItems.length) return res.status(400).json({ error: 'Invalid items' });
					    if (courierCharge != null && (!Number.isFinite(courierCharge) || courierCharge < 0)) return res.status(400).json({ error: 'Invalid Courier Charge' });
					    if (packingCharge != null && (!Number.isFinite(packingCharge) || packingCharge < 0)) return res.status(400).json({ error: 'Invalid Packing Charge' });
					    if (labourCharge != null && (!Number.isFinite(labourCharge) || labourCharge < 0)) return res.status(400).json({ error: 'Invalid Labour Charge' });
					    if (otherCharge != null && (!Number.isFinite(otherCharge) || otherCharge < 0)) return res.status(400).json({ error: 'Invalid Other Charge' });
					    if (chargesGstAmount != null && (!Number.isFinite(chargesGstAmount) || chargesGstAmount < 0))
					      return res.status(400).json({ error: 'Invalid GST on Charges amount' });

				    try {
						      const invoice = await updateInvoice(invoiceId, {
						        supplierInvoiceNo,
						        invoiceDate,
						        invoiceAmount,
						        courierCharge,
						        packingCharge,
						        labourCharge,
						        otherCharge,
						        chargesGstAmount,
						        updatedBy,
						        items: normalizedItems,
						      });
				      await bestEffortSnapshot();
				      res.json({ invoice });
				    } catch (e: any) {
				      sendError(res, e);
				    }
				  });

				  app.put('/invoices/:id/payment', async (req, res) => {
				    const invoiceId = String(req.params.id ?? '').trim();
				    const paymentStatus = String(req.body?.paymentStatus ?? '').trim();
				    const paymentDate = String(req.body?.paymentDate ?? '').trim();
				    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
				    if (!invoiceId || !paymentStatus || !paymentDate) return res.status(400).json({ error: 'Invalid payload' });
				    try {
				      const invoice = await updateInvoicePayment(invoiceId, { paymentStatus, paymentDate, updatedBy });
				      await bestEffortSnapshot();
				      res.json({ invoice });
				    } catch (e: any) {
				      sendError(res, e);
				    }
				  });

				  app.delete('/invoices/:id', async (req, res) => {
				    try {
				      const invoiceId = String(req.params.id ?? '').trim();
				      if (!invoiceId) return res.status(400).json({ error: 'Missing invoice id' });
				      const result = await deleteInvoice(invoiceId);
				      await bestEffortSnapshot();
				      res.json(result);
				    } catch (e) {
				      sendError(res, e);
				    }
				  });

				  app.post('/invoices/:id/grn', async (req, res) => {
		    const invoiceId = String(req.params.id ?? '');
		    const receivedDate = String(req.body?.receivedDate ?? '').trim();
		    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
		    const items = Array.isArray(req.body?.items) ? req.body.items : [];
		    if (!receivedDate || !items.length) return res.status(400).json({ error: 'Invalid payload' });
	    const normalizedItems = items
	      .map((it: any) => ({
	        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
	        item: it.item != null ? String(it.item).trim() : undefined,
	        quantityReceived: Number(it.quantityReceived ?? 0),
	      }))
	      .filter((it: any) => (it.itemId || it.item) && Number.isFinite(it.quantityReceived) && it.quantityReceived >= 0);
			    try {
			      const grn = await createGrn({ invoiceId, receivedDate, updatedBy, items: normalizedItems });
			      await bestEffortSnapshot();
			      res.status(201).json({ grn });
			    } catch (e: any) {
		      sendError(res, e);
			    }
			  });

			  app.get('/invoices/:id/grn-link-summary', async (req, res) => {
			    const invoiceId = String(req.params.id ?? '').trim();
			    if (!invoiceId) return res.status(400).json({ error: 'Invalid payload' });
			    try {
			      const links = await getGrnInvoiceLinkSummary(invoiceId);
			      res.json({ links });
			    } catch (e: any) {
			      sendError(res, e);
			    }
			  });

				  app.post('/invoices/:id/grn-links', async (req, res) => {
				    const invoiceId = String(req.params.id ?? '').trim();
				    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
				    const links = Array.isArray(req.body?.links) ? req.body.links : [];
				    if (!invoiceId || !links.length) return res.status(400).json({ error: 'Invalid payload' });
				    const normalized = links
				      .map((l: any) => ({
				        invoiceItemId: String(l.invoiceItemId ?? '').trim(),
				        linkedQty: Number(l.linkedQty ?? 0),
				      }))
				      .filter((l: any) => l.invoiceItemId && Number.isFinite(l.linkedQty) && l.linkedQty >= 0);
				    try {
				      const result = await setGrnInvoiceLinks({ invoiceId, updatedBy, links: normalized });
				      await bestEffortSnapshot();
				      res.json(result);
				    } catch (e: any) {
				      sendError(res, e);
				    }
				  });

				  app.get('/requests/:id/grn-item-invoice-links', async (req, res) => {
				    try {
				      const prId = String(req.params.id ?? '').trim();
				      if (!prId) return res.status(400).json({ error: 'Missing PR id' });
				      const links = await listGrnItemInvoiceLinkSummaryByPrId(prId);
				      res.json({ links });
				    } catch (e: any) {
				      sendError(res, e);
				    }
				  });

				  app.get('/grn-items/:id/invoice-links', async (req, res) => {
				    try {
				      const grnItemId = String(req.params.id ?? '').trim();
				      if (!grnItemId) return res.status(400).json({ error: 'Missing GRN item id' });
				      const links = await getGrnItemInvoiceLinks(grnItemId);
				      res.json({ links });
				    } catch (e: any) {
				      sendError(res, e);
				    }
				  });

					  app.post('/grn-items/:id/invoice-links', async (req, res) => {
					    const grnItemId = String(req.params.id ?? '').trim();
					    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
					    const links = Array.isArray(req.body?.links) ? req.body.links : [];
					    if (!grnItemId) return res.status(400).json({ error: 'Missing GRN item id' });
				    const normalized = links
				      .map((l: any) => ({
				        invoiceItemId: String(l.invoiceItemId ?? '').trim(),
				        linkedQty: Number(l.linkedQty ?? 0),
				      }))
				      .filter((l: any) => l.invoiceItemId && Number.isFinite(l.linkedQty) && l.linkedQty >= 0);
				    try {
				      const result = await setGrnItemInvoiceLinks({ grnItemId, updatedBy, links: normalized });
				      await bestEffortSnapshot();
				      res.json(result);
				    } catch (e: any) {
				      sendError(res, e);
				    }
					  });

					  app.get('/grns/:id/pending-invoice-links', async (req, res) => {
					    try {
					      const grnId = String(req.params.id ?? '').trim();
					      if (!grnId) return res.status(400).json({ error: 'Missing GRN id' });
					      const rows = await listPendingGrnInvoiceLinksByGrnId(grnId);
					      res.json({ rows });
					    } catch (e: any) {
					      sendError(res, e);
					    }
					  });

							  app.post('/grns/:id/qc', async (req, res) => {
				    const grnId = String(req.params.id ?? '');
				    const inspectedBy = String(req.body?.inspectedBy ?? '').trim();
			    const location = String(req.body?.location ?? '').trim();
		    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
		    const items = Array.isArray(req.body?.items) ? req.body.items : [];
		    if (!inspectedBy || !location || !items.length) return res.status(400).json({ error: 'Invalid payload' });
		    const normalizedItems = items
		      .map((it: any) => ({
		        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
		        item: it.item != null ? String(it.item).trim() : undefined,
		        quantityAccepted: Number(it.quantityAccepted ?? 0),
		        quantityRejected: Number(it.quantityRejected ?? 0),
		        remarks: String(it.remarks ?? '').trim(),
		      }))
		      .filter((it: any) => (it.itemId || it.item) && Number.isFinite(it.quantityAccepted) && Number.isFinite(it.quantityRejected));
				    try {
				      const qc = await recordQc({ grnId, inspectedBy, location, updatedBy, items: normalizedItems });
				      await bestEffortSnapshot();
				      res.json(qc);
				    } catch (e: any) {
			      sendError(res, e);
			    }
					  });

					  app.put('/grns/:id/qc', async (req, res) => {
					    const grnId = String(req.params.id ?? '');
					    const inspectedBy = String(req.body?.inspectedBy ?? '').trim();
					    const location = String(req.body?.location ?? '').trim();
					    const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
					    const items = Array.isArray(req.body?.items) ? req.body.items : [];
					    if (!inspectedBy || !location || !items.length) return res.status(400).json({ error: 'Invalid payload' });
					    const normalizedItems = items
					      .map((it: any) => ({
					        itemId: String(it.itemId ?? it.item_id ?? '').trim() || undefined,
					        item: it.item != null ? String(it.item).trim() : undefined,
					        quantityAccepted: Number(it.quantityAccepted ?? 0),
					        quantityRejected: Number(it.quantityRejected ?? 0),
					        remarks: String(it.remarks ?? '').trim(),
					      }))
					      .filter((it: any) => (it.itemId || it.item) && Number.isFinite(it.quantityAccepted) && Number.isFinite(it.quantityRejected));
					    try {
					      const qc = await replaceQcForGrn({ grnId, inspectedBy, location, updatedBy, items: normalizedItems });
					      await bestEffortSnapshot();
					      res.json(qc);
					    } catch (e: any) {
					      sendError(res, e);
					    }
					  });

					  app.delete('/grns/:id/qc', async (req, res) => {
					    const grnId = String(req.params.id ?? '').trim();
					    const by = String(req.body?.by ?? req.body?.updatedBy ?? '').trim() || 'system';
					    if (!grnId) return res.status(400).json({ error: 'Invalid payload' });
					    try {
					      const result = await deleteQcForGrn({ grnId, by });
					      await bestEffortSnapshot();
					      res.json(result);
					    } catch (e) {
					      sendError(res, e);
					    }
					  });

					  app.put('/grns/:id', async (req, res) => {
					    try {
					      const grnId = String(req.params.id ?? '').trim();
					      const receivedDate = String(req.body?.receivedDate ?? '').trim();
					      const updatedBy = req.body?.updatedBy ? String(req.body.updatedBy).trim() : undefined;
					      const materialReceivedBy = req.body?.materialReceivedBy != null ? String(req.body.materialReceivedBy).trim() : null;
					      const goodsCollectedBy = req.body?.goodsCollectedBy != null ? String(req.body.goodsCollectedBy).trim() : null;
					      if (!grnId || !receivedDate) return res.status(400).json({ error: 'Invalid payload' });
					      const grn = await updateGrn({ grnId, receivedDate, updatedBy, materialReceivedBy, goodsCollectedBy });
					      await bestEffortSnapshot();
					      res.json({ grn });
					    } catch (e) {
					      sendError(res, e);
					    }
					  });

				  app.delete('/grns/:id', async (req, res) => {
				    try {
				      const grnId = String(req.params.id ?? '').trim();
				      if (!grnId) return res.status(400).json({ error: 'Missing GRN id' });
				      const result = await deleteGrn(grnId);
				      await bestEffortSnapshot();
				      res.json(result);
				    } catch (e) {
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
		    const poId = req.query?.poId ? String(req.query.poId) : undefined;
				    try {
				      const workflow = await getWorkflow(prId, poId);
				      res.json({ workflow });
				    } catch (e: any) {
				      res.status(404).json({ error: e?.message ?? String(e) });
				    }
				  });

	  const parseOpsFilters = (req: express.Request) => ({
	    q: req.query?.q ? String(req.query.q) : '',
	    firmId: req.query?.firmId ? String(req.query.firmId) : '',
	    projectId: req.query?.projectId ? String(req.query.projectId) : '',
	    supplierId: req.query?.supplierId ? String(req.query.supplierId) : '',
	    status: req.query?.status ? String(req.query.status) : '',
	    from: req.query?.from ? String(req.query.from) : '',
	    to: req.query?.to ? String(req.query.to) : '',
	  });

	  // Operations (read-only)
	  app.get('/operations/prs', async (req, res) => {
	    try {
	      res.json({ rows: await listOperationsPr(parseOpsFilters(req)) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/prs/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      res.json({ detail: await getOperationsPrDetail(id) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/prs.xlsx', async (req, res) => {
	    try {
	      const rows = await listOperationsPr(parseOpsFilters(req));
	      const buf = await exportOperationsSheetBuffer('PRs', rows);
	      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	      res.setHeader('Content-Disposition', 'attachment; filename="operations_prs.xlsx"');
	      res.status(200).send(buf);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/operations/pos', async (req, res) => {
	    try {
	      res.json({ rows: await listOperationsPo(parseOpsFilters(req)) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/pos/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      res.json({ detail: await getOperationsPoDetail(id) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/pos.xlsx', async (req, res) => {
	    try {
	      const rows = await listOperationsPo(parseOpsFilters(req));
	      const buf = await exportOperationsSheetBuffer('POs', rows);
	      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	      res.setHeader('Content-Disposition', 'attachment; filename="operations_pos.xlsx"');
	      res.status(200).send(buf);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/operations/grns', async (req, res) => {
	    try {
	      res.json({ rows: await listOperationsGrns(parseOpsFilters(req)) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/grns/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      res.json({ detail: await getOperationsGrnDetail(id) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/grns.xlsx', async (req, res) => {
	    try {
	      const rows = await listOperationsGrns(parseOpsFilters(req));
	      const buf = await exportOperationsSheetBuffer('GRNs', rows);
	      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	      res.setHeader('Content-Disposition', 'attachment; filename="operations_grns.xlsx"');
	      res.status(200).send(buf);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/operations/invoices', async (req, res) => {
	    try {
	      res.json({ rows: await listOperationsInvoices(parseOpsFilters(req)) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/invoices/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      res.json({ detail: await getOperationsInvoiceDetail(id) });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	  app.get('/operations/invoices.xlsx', async (req, res) => {
	    try {
	      const rows = await listOperationsInvoices(parseOpsFilters(req));
	      const buf = await exportOperationsSheetBuffer('Invoices', rows);
	      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	      res.setHeader('Content-Disposition', 'attachment; filename="operations_invoices.xlsx"');
	      res.status(200).send(buf);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

		  app.get('/operations/payments', async (req, res) => {
		    try {
		      res.json({ rows: await listOperationsPayments(parseOpsFilters(req)) });
		    } catch (e) {
		      sendError(res, e);
		    }
		  });
		  app.get('/operations/payments/:id', async (req, res) => {
		    try {
		      const id = String(req.params.id ?? '').trim();
		      res.json({ detail: await getOperationsPaymentDetail(id) });
		    } catch (e) {
		      sendError(res, e);
		    }
		  });
		  app.get('/operations/payments.xlsx', async (req, res) => {
		    try {
		      const rows = await listOperationsPayments(parseOpsFilters(req));
		      const buf = await exportOperationsSheetBuffer('Payments', rows);
	      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	      res.setHeader('Content-Disposition', 'attachment; filename="operations_payments.xlsx"');
	      res.status(200).send(buf);
	    } catch (e) {
	      sendError(res, e);
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

		  app.post('/items/last-supplier', async (req, res) => {
		    try {
		      const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
		      const normalized = itemIds.map((x: any) => String(x ?? '').trim()).filter(Boolean);
		      res.json({ byItemId: await getLastSupplierByItemIds(normalized) });
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

	  app.get('/masters/projects', async (_req, res) => {
	    try {
	      res.json({ projects: await listProjects() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/projects', async (req, res) => {
	    try {
	      const firmId = String(req.body?.firmId ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const clientName = req.body?.clientName != null ? String(req.body.clientName).trim() : null;
	      const startDate = req.body?.startDate != null ? String(req.body.startDate).trim() : null;
	      const endDate = req.body?.endDate != null ? String(req.body.endDate).trim() : null;
	      const status = req.body?.status != null ? String(req.body.status).trim() : null;
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';

	      const project = await createProject({ firmId, name, clientName, startDate, endDate, status, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ project });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/projects/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const firmId = String(req.body?.firmId ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const clientName = req.body?.clientName != null ? String(req.body.clientName).trim() : null;
	      const startDate = req.body?.startDate != null ? String(req.body.startDate).trim() : null;
	      const endDate = req.body?.endDate != null ? String(req.body.endDate).trim() : null;
	      const status = req.body?.status != null ? String(req.body.status).trim() : null;
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';

	      const project = await updateProject({ id, firmId, name, clientName, startDate, endDate, status, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ project });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.delete('/masters/projects/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
	      const result = await deleteProject({ id, deletedBy });
	      await bestEffortSnapshot();
	      res.json(result);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

  app.post('/masters/firms', async (req, res) => {
      try {
        const name = String(req.body?.name ?? '').trim();
        const cin = req.body?.cin != null ? String(req.body.cin).trim() : null;
        const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null;
        const address = req.body?.address != null ? String(req.body.address).trim() : null;
        const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
        const logoUrl = req.body?.logoUrl != null ? String(req.body.logoUrl).trim() : null;
        const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
        const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
        const firm = await createFirm({ name, cin, gstNumber, address, phone, logoUrl, termsConditions, createdBy });
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
        const cin = req.body?.cin != null ? String(req.body.cin).trim() : null;
        const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber).trim() : null;
        const address = req.body?.address != null ? String(req.body.address).trim() : null;
        const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
        const logoUrl = req.body?.logoUrl != null ? String(req.body.logoUrl).trim() : null;
        const termsConditions = req.body?.termsConditions != null ? String(req.body.termsConditions).trim() : null;
        const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
        const firm = await updateFirm({ id, name, cin, gstNumber, address, phone, logoUrl, termsConditions, updatedBy });
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

	  app.get('/masters/departments', async (_req, res) => {
	    try {
	      res.json({ departments: await listDepartments() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/departments', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const department = await createDepartment({ name, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ department });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/departments/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const department = await updateDepartment({ id, name, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ department });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.delete('/masters/departments/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
	      const result = await deleteDepartment({ id, deletedBy });
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

	  app.get('/masters/customers', async (_req, res) => {
	    try {
	      res.json({ customers: await listCustomers() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/customers', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
	      const address = req.body?.address != null ? String(req.body.address).trim() : undefined;
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const customer = await createCustomer({ name, phone, address, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ customer });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/customers/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
	      const address = req.body?.address != null ? String(req.body.address).trim() : undefined;
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const customer = await updateCustomer({ id, name, phone, address, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ customer });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.delete('/masters/customers/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
	      const result = await deleteCustomer({ id, deletedBy });
	      await bestEffortSnapshot();
	      res.json(result);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });
	
		  app.post('/masters/suppliers', async (req, res) => {
		    try {
		      const name = String(req.body?.name ?? '').trim();
	      const gstNumber = req.body?.gstNumber != null ? String(req.body.gstNumber) : undefined;
	      const gstType = req.body?.gstType != null ? String(req.body.gstType).trim() : undefined;
	      const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms) : undefined;
	      const address = req.body?.address != null ? String(req.body.address).trim() : undefined;
	      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const supplier = await createSupplier({ name, gstNumber, gstType, paymentTerms, address, phone, createdBy });
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
	      const gstType = req.body?.gstType != null ? String(req.body.gstType).trim() : undefined;
	      const paymentTerms = req.body?.paymentTerms != null ? String(req.body.paymentTerms) : undefined;
	      const address = req.body?.address != null ? String(req.body.address).trim() : undefined;
	      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const supplier = await updateSupplier({ id, name, gstNumber, gstType, paymentTerms, address, phone, updatedBy });
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

  app.get('/masters/transporters', async (_req, res) => {
    try {
      res.json({ transporters: await listTransporters() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/masters/transporters', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const phone = req.body?.phone != null ? String(req.body.phone).trim() : undefined;
      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
      const transporter = await createTransporter({ name, phone, createdBy });
      await bestEffortSnapshot();
      res.status(201).json({ transporter });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put('/masters/transporters/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;
      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
      const transporter = await updateTransporter({ id, name, phone, updatedBy });
      await bestEffortSnapshot();
      res.json({ transporter });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/masters/transporters/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
      const result = await deleteTransporter({ id, deletedBy });
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

	  app.get('/masters/units', async (_req, res) => {
	    try {
	      res.json({ units: await listUnits() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/units', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const unit = await createUnit({ name, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ unit });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/units/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const unit = await updateUnit({ id, name, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ unit });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.delete('/masters/units/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
	      const result = await deleteUnit({ id, deletedBy });
	      await bestEffortSnapshot();
	      res.json(result);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.get('/masters/item-categories', async (_req, res) => {
	    try {
	      res.json({ itemCategories: await listItemCategories() });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/item-categories', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const itemCategory = await createItemCategory({ name, createdBy });
	      await bestEffortSnapshot();
	      res.status(201).json({ itemCategory });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.put('/masters/item-categories/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const name = String(req.body?.name ?? '').trim();
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const itemCategory = await updateItemCategory({ id, name, updatedBy });
	      await bestEffortSnapshot();
	      res.json({ itemCategory });
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.delete('/masters/item-categories/:id', async (req, res) => {
	    try {
	      const id = String(req.params.id ?? '').trim();
	      const deletedBy = String(req.body?.deletedBy ?? 'system').trim() || 'system';
	      const result = await deleteItemCategory({ id, deletedBy });
	      await bestEffortSnapshot();
	      res.json(result);
	    } catch (e) {
	      sendError(res, e);
	    }
	  });

	  app.post('/masters/item-names', async (req, res) => {
	    try {
	      const name = String(req.body?.name ?? '').trim();
	      const unitId = req.body?.unitId != null ? String(req.body.unitId) : undefined;
	      const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId) : undefined;
	      const createdBy = String(req.body?.createdBy ?? 'system').trim() || 'system';
	      const itemName = await createItemName({ name, unitId, itemCategoryId, createdBy });
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
	      const unitId = req.body?.unitId != null ? String(req.body.unitId) : undefined;
	      const itemCategoryId = req.body?.itemCategoryId != null ? String(req.body.itemCategoryId) : undefined;
	      const updatedBy = String(req.body?.updatedBy ?? 'system').trim() || 'system';
	      const itemName = await updateItemName({ id, name, unitId, itemCategoryId, updatedBy });
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

  // --- Inventory Balances ---
  app.get('/inventory/sheet', async (req, res) => {
    try {
      const firmId = String(req.query.firmId ?? '').trim();
      const year = String(req.query.year ?? '2024-25').trim();
      if (!firmId) return res.status(400).json({ error: 'firmId is required' });
      const rows = await getFirmInventorySheet(firmId, year);
      res.json({ rows });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/inventory/opening-balances', async (req, res) => {
    try {
      const storeId = String(req.query.storeId ?? '').trim();
      const year = String(req.query.year ?? '2024-25').trim();
      if (!storeId) return res.status(400).json({ error: 'storeId is required' });
      const balances = await listOpeningBalances(storeId, year);
      res.json({ balances });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/inventory/opening-balances', async (req, res) => {
    try {
      const storeId = String(req.body.storeId ?? '').trim();
      const year = String(req.body.year ?? '2024-25').trim();
      const balances = Array.isArray(req.body.balances) ? req.body.balances : [];
      if (!storeId) return res.status(400).json({ error: 'storeId is required' });

      for (const b of balances) {
        await upsertOpeningBalance({
          storeId,
          itemId: String(b.itemId),
          quantity: Number(b.quantity ?? 0),
          year,
        });
      }
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  return app;
}
