import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FirmRow, PoWithItems } from './sqliteStore';
import { formatDateDDMMYYYYOnly } from '../lib/date';

type WrapLine = { text: string; width: number };

function wrapText(args: { text: string; font: any; size: number; maxWidth: number }): WrapLine[] {
  const { text, font, size, maxWidth } = args;
  const normalized = sanitizePdfText(String(text ?? '')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split('\n');
  const out: WrapLine[] = [];

  for (const para of paragraphs) {
    const raw = para.trim();
    if (!raw) {
      out.push({ text: '', width: 0 });
      continue;
    }
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width <= maxWidth || !line) {
        line = candidate;
        continue;
      }
      out.push({ text: line, width: font.widthOfTextAtSize(line, size) });
      line = w;
    }
    if (line) out.push({ text: line, width: font.widthOfTextAtSize(line, size) });
  }

  return out.length ? out : [{ text: '', width: 0 }];
}

function safeFilenamePart(s: string) {
  return String(s ?? '')
    .trim()
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatQty(q: number) {
  if (!Number.isFinite(q)) return '';
  if (Math.abs(q - Math.round(q)) < 1e-9) return String(Math.round(q));
  return String(q);
}

function formatMoney(value: number) {
  const num = Number(value ?? 0);
  const v = Number.isFinite(num) ? num : 0;
  const formatted = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  // Keep numbers only (no currency symbol/prefix) for WinAnsi compatibility + user preference.
  return formatted;
}

function normalizeLogoDataUrl(input: string) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(s);
  if (!m) return null;
  const kind = String(m[1] ?? '').toLowerCase();
  const base64 = String(m[2] ?? '');
  return { kind: kind === 'jpg' ? 'jpeg' : kind, base64 };
}

function sniffImageKind(bytes: Uint8Array) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some hosts block default fetch UA; keep it simple and common.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'image/*,text/html;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function extractOgImageUrl(html: string) {
  const h = String(html ?? '');
  const m1 = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(h);
  if (m1?.[1]) return m1[1];
  const m2 = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(h);
  if (m2?.[1]) return m2[1];
  return null;
}

async function loadLogoBytesFromUrl(url: string): Promise<{ kind: 'png' | 'jpeg'; bytes: Uint8Array } | null> {
  const u = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const res = await fetchWithTimeout(u);
    if (!res.ok) return null;
    const ct = String(res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.startsWith('image/')) {
      const buf = new Uint8Array(await res.arrayBuffer());
      const kind = sniffImageKind(buf) ?? (ct.includes('png') ? 'png' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpeg' : null);
      if (kind !== 'png' && kind !== 'jpeg') return null;
      return { kind, bytes: buf };
    }
    if (ct.includes('text/html') || ct.includes('application/xhtml')) {
      const html = await res.text();
      const imgUrl = extractOgImageUrl(html);
      if (!imgUrl) return null;
      const res2 = await fetchWithTimeout(imgUrl);
      if (!res2.ok) return null;
      const buf = new Uint8Array(await res2.arrayBuffer());
      const kind = sniffImageKind(buf);
      if (kind !== 'png' && kind !== 'jpeg') return null;
      return { kind, bytes: buf };
    }
    return null;
  } catch {
    return null;
  }
}

function prettyPoNumber(poId: string) {
  const raw = String(poId ?? '').trim();
  if (!raw) return '';
  // Preferred: FY format like "#PO-26-27/0001" -> "26-27/0001"
  const fy = /#?PO-(\d{2}-\d{2}\/\d{4})/i.exec(raw);
  if (fy?.[1]) return fy[1];

  // Fallback: show the final numeric segment when possible (similar to sample "Purchase Order #00551")
  const m = /(\d{3,})\s*$/.exec(raw.replace(/[#\s]/g, ''));
  if (m) return m[1]!;
  return raw.replace(/^#/, '');
}

function sanitizePdfText(input: string) {
  // `pdf-lib` StandardFonts use WinAnsi encoding, which fails on many unicode chars (e.g. ₹, ☎).
  const s = String(input ?? '');
  const replaced = s
    .replace(/\u20B9/g, 'Rs.') // ₹
    .replace(/\u260E/g, 'Phone') // ☎
    .replace(/\u00A0/g, ' ') // nbsp
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');

  // Replace any remaining non-ASCII with '?'
  return replaced.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function specsJsonToInline(specificationsJson?: string) {
  const raw = String(specificationsJson ?? '').trim();
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return '';
    const parts: string[] = [];
    for (const k of Object.keys(obj)) {
      const v = (obj as any)[k];
      const key = String(k ?? '').trim();
      const val = v == null ? '' : String(v).trim();
      if (!key || !val) continue;
      parts.push(`${key}: ${val}`);
    }
    return parts.join(' - ');
  } catch {
    return '';
  }
}

function formatItemLabel(itemName: string, specificationsJson?: string) {
  const name = String(itemName ?? '').trim() || '-';
  const specs = specsJsonToInline(specificationsJson);
  return specs ? `${name} - ${specs}` : name;
}

export async function generatePurchaseOrderPdfBuffer(args: {
  po: PoWithItems;
  firm?: FirmRow | null;
  firmName?: string;
  orderDate?: string | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { po, firm, firmName, orderDate } = args;
  const poRow = po.po;
  const items = po.items ?? [];
  const paymentTerms = String(poRow.paymentTerms ?? '').trim();
  const showDiscCol = (items ?? []).some((it: any) => Number(it?.discountPercent ?? 0) > 0);
  const showGstCol = (items ?? []).some((it: any) => Number(it?.taxPercent ?? 0) > 0);
  const intra = String(poRow.supplierGstType ?? '').toLowerCase() === 'intra-state';
  const inter = String(poRow.supplierGstType ?? '').toLowerCase() === 'inter-state';

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const A4 = { width: 595.28, height: 841.89 };
  const marginX = 48;
  const marginTop = 52;
  const marginBottom = 52;
  const gap = 3;

  const textColor = rgb(0, 0, 0);
  // PDF styling requirement: no grey/colored text.
  const blue = textColor;
  const muted = textColor;
  const white = rgb(1, 1, 1);
  const line = rgb(0, 0, 0);

  const body = 10.5;
  const small = 9.5;

  const filename = `${safeFilenamePart(poRow.id || 'PO') || 'PO'}.pdf`;

  let page = pdfDoc.addPage([A4.width, A4.height]);
  let y = A4.height - marginTop;

  const measureText = (t: string, size: number, bold = false) =>
    (bold ? fontBold : fontRegular).widthOfTextAtSize(sanitizePdfText(String(t ?? '')), size);

  const newPage = () => {
    page = pdfDoc.addPage([A4.width, A4.height]);
    y = A4.height - marginTop;
  };

  const ensureSpace = (h: number) => {
    if (y - h < marginBottom) newPage();
  };

  const drawText = (t: string, x: number, yPos: number, size: number, bold = false, color = textColor) => {
    const text = sanitizePdfText(String(t ?? ''));
    page.drawText(text, { x, y: yPos, size, font: bold ? fontBold : fontRegular, color });
  };

  const drawParagraph = (t: string, x: number, maxWidth: number, size: number, bold = false, color = textColor) => {
    const lines = wrapText({ text: t, font: bold ? fontBold : fontRegular, size, maxWidth });
    for (const ln of lines) {
      y -= size;
      drawText(ln.text, x, y, size, bold, color);
      y -= gap;
    }
  };

  const drawParagraphAt = (t: string, x: number, yTop: number, maxWidth: number, size: number, bold = false, color = textColor) => {
    let yLocal = yTop;
    const lines = wrapText({ text: t, font: bold ? fontBold : fontRegular, size, maxWidth });
    for (const ln of lines) {
      yLocal -= size;
      drawText(ln.text, x, yLocal, size, bold, color);
      yLocal -= gap;
    }
    return yLocal;
  };

  const drawKeyValueAt = (args: {
    x: number;
    yTop: number;
    maxWidth: number;
    label: string;
    value: string;
    size: number;
    labelColor?: any;
    valueColor?: any;
    boldValue?: boolean;
  }) => {
    const { x, yTop, maxWidth, label, value, size, labelColor = muted, valueColor = textColor, boldValue = false } = args;
    const labelText = `${label} `;
    const labelW = measureText(labelText, size, false);
    const valueW = measureText(value, size, boldValue);
    let yLocal = yTop;

    if (labelW + valueW <= maxWidth) {
      yLocal -= size;
      drawText(labelText, x, yLocal, size, false, labelColor);
      drawText(value, x + labelW, yLocal, size, boldValue, valueColor);
      yLocal -= gap;
      return yLocal;
    }

    yLocal -= size;
    drawText(label.trimEnd(), x, yLocal, size, false, labelColor);
    yLocal -= gap + 2;
    yLocal = drawParagraphAt(value, x, yLocal, maxWidth, size, boldValue, valueColor);
    return yLocal;
  };

  // ===== Header (Logo + Title) =====
  const leftX = marginX;
  const rightX = Math.round(A4.width / 2) + 24;
  const rightW = A4.width - marginX - rightX;
  const leftW = rightX - leftX - 16;

  const firmDisplayName = String(firm?.name ?? firmName ?? '').trim() || 'Purchase Order';
  const firmAddress = String(firm?.address ?? '').trim();
  const firmGst = String(firm?.gstNumber ?? '').trim();
  const firmPhone = String(firm?.phone ?? '').trim();
  const firmLogoUrl = String(firm?.logoUrl ?? '').trim();

  const supplierName = String(poRow.supplier ?? '').trim();
  const supplierAddress = String(poRow.supplierAddress ?? '').trim();
  const supplierGst = String(poRow.supplierGstNumber ?? '').trim();

  const shippingAddress = String(poRow.shippingAddress ?? '').trim() || firmAddress;
  const dateValue = formatDateDDMMYYYYOnly(orderDate ?? poRow.orderDate ?? poRow.createdAt ?? new Date());
  const paymentTermsValue = paymentTerms ? `${paymentTerms} days` : '-';

  // Logo (optional): supports data-url, or an http(s) URL (including share pages via og:image)
  const logo = normalizeLogoDataUrl(firmLogoUrl);
  try {
    let embedded: { kind: 'png' | 'jpeg'; bytes: Uint8Array } | null = null;
    if (logo) embedded = { kind: logo.kind as any, bytes: Buffer.from(logo.base64, 'base64') };
    else embedded = await loadLogoBytesFromUrl(firmLogoUrl);

    if (embedded) {
      const img = embedded.kind === 'png' ? await pdfDoc.embedPng(embedded.bytes) : await pdfDoc.embedJpg(embedded.bytes);
      const maxW = 110;
      const maxH = 110;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (A4.width - w) / 2;
      page.drawImage(img, { x, y: y - h, width: w, height: h });
      // Keep comfortable vertical gap between logo and title.
      // `drawText` uses y as the lower-left of the glyph box, so leave extra space for title height.
      y = y - h - 40;
    } else {
      y -= 6;
    }
  } catch {
    // ignore logo errors
  }

  // ===== Title (below logo) =====
  const poNoPretty = prettyPoNumber(poRow.id);
  const title = `Purchase Order #${poNoPretty || (poRow.id || '')}`.trim();
  const titleW = measureText(title, 22, true);
  drawText(title, (A4.width - titleW) / 2, y, 22, true, blue);
  y -= 30;

  // ===== Buyer + Supplier blocks =====
  const blocksTop = y;
  const firmBlockX = leftX;
  const firmBlockW = Math.max(120, leftW);

  // Buyer (left)
  let yLeft = blocksTop;
  yLeft -= small;
  drawText('Buyer', firmBlockX, yLeft, small, true, muted);
  yLeft -= 4;
  yLeft = drawParagraphAt(firmDisplayName, firmBlockX, yLeft, firmBlockW, 12.5, true);
  if (firmAddress) yLeft = drawParagraphAt(firmAddress, firmBlockX, yLeft, firmBlockW, body, false);
  if (firmGst) yLeft = drawParagraphAt(`GSTIN: ${firmGst}`, firmBlockX, yLeft, firmBlockW, body, false);
  if (shippingAddress) {
    yLeft -= 2;
    yLeft = drawParagraphAt('Shipping address', firmBlockX, yLeft, firmBlockW, small, true, muted);
    yLeft = drawParagraphAt(shippingAddress, firmBlockX, yLeft, firmBlockW, body, false);
  }
  if (firmPhone) yLeft = drawParagraphAt(`Phone: ${firmPhone}`, firmBlockX, yLeft, firmBlockW, body, false);

  // Supplier (right)
  let yRight = blocksTop;
  yRight -= small;
  drawText('Supplier', rightX, yRight, small, true, muted);
  yRight -= 4;
  yRight = drawParagraphAt(supplierName || '-', rightX, yRight, rightW, 11.5, true);
  if (supplierAddress) yRight = drawParagraphAt(supplierAddress, rightX, yRight, rightW, body, false);
	  if (supplierGst) yRight = drawParagraphAt(`GSTIN: ${supplierGst}`, rightX, yRight, rightW, body, false);
	  // Order Date + Payment Terms below GST (one after another with one-line gap)
	  yRight -= body + 4;
	  yRight = drawKeyValueAt({ x: rightX, yTop: yRight, maxWidth: rightW, label: 'Order Date:', value: dateValue, size: body });
	  yRight -= body + 4; // one line gap
	  yRight = drawKeyValueAt({ x: rightX, yTop: yRight, maxWidth: rightW, label: 'Payment Terms:', value: paymentTermsValue, size: body });

  y = Math.min(yLeft, yRight) - 18;
  ensureSpace(120);

  // ===== Items Table =====
  const tableX = leftX;
  const tableW = A4.width - marginX * 2;
  // PDF styling requirement: black text on white, no borders.
  const headerBg = white;

  const showCgstSgstCols = showGstCol && intra;
  const showIgstCol = showGstCol && inter;

  const colQty = 36;
  const colRate = 50;
  const colDiscPct = showDiscCol ? 40 : 0;
  const colDiscAmt = showDiscCol ? 55 : 0;
  const colGstRate = showGstCol ? 40 : 0;
  const colCgst = showCgstSgstCols ? 40 : 0;
  const colSgst = showCgstSgstCols ? 40 : 0;
  const colIgst = showIgstCol ? 60 : 0;
  const colAmtMin = 60;

  const fixedW = colQty + colRate + colDiscPct + colDiscAmt + colGstRate + colCgst + colSgst + colIgst + colAmtMin;
  const colItems = Math.max(150, tableW - fixedW);
  const colAmt = tableW - (colItems + colQty + colRate + colDiscPct + colDiscAmt + colGstRate + colCgst + colSgst + colIgst);

  const colXs = {
    items: tableX,
    qty: tableX + colItems,
    rate: tableX + colItems + colQty,
    discPct: tableX + colItems + colQty + colRate,
    discAmt: tableX + colItems + colQty + colRate + colDiscPct,
    gstRate: tableX + colItems + colQty + colRate + colDiscPct + colDiscAmt,
    cgst: tableX + colItems + colQty + colRate + colDiscPct + colDiscAmt + colGstRate,
    sgst: tableX + colItems + colQty + colRate + colDiscPct + colDiscAmt + colGstRate + colCgst,
    igst: tableX + colItems + colQty + colRate + colDiscPct + colDiscAmt + colGstRate + colCgst + colSgst,
    amt: tableX + colItems + colQty + colRate + colDiscPct + colDiscAmt + colGstRate + colCgst + colSgst + colIgst,
    end: tableX + tableW,
  };

  const headerSeparators = [colXs.qty, colXs.rate];
  if (showDiscCol) headerSeparators.push(colXs.discPct, colXs.discAmt);
  if (showGstCol) headerSeparators.push(colXs.gstRate);
  if (showCgstSgstCols) headerSeparators.push(colXs.cgst, colXs.sgst);
  if (showIgstCol) headerSeparators.push(colXs.igst);
  headerSeparators.push(colXs.amt);

  const headerH = 22;
  page.drawRectangle({ x: tableX, y: y - headerH, width: tableW, height: headerH, color: headerBg });
  const headerTextY = y - 15;
  drawText('Items', colXs.items + 6, headerTextY, small, true, textColor);
  drawText('Qty', colXs.qty + 6, headerTextY, small, true, textColor);
  drawText('Rate', colXs.rate + 6, headerTextY, small, true, textColor);
  if (showDiscCol) {
    drawText('Disc %', colXs.discPct + 6, headerTextY, small, true, textColor);
    drawText('Disc Amt', colXs.discAmt + 6, headerTextY, small, true, textColor);
  }
  if (showGstCol) {
    drawText('GST %', colXs.gstRate + 6, headerTextY, small, true, textColor);
    if (showCgstSgstCols) {
      drawText('CGST', colXs.cgst + 6, headerTextY, small, true, textColor);
      drawText('SGST', colXs.sgst + 6, headerTextY, small, true, textColor);
    }
    if (showIgstCol) {
      drawText('IGST', colXs.igst + 6, headerTextY, small, true, textColor);
    }
  }
  drawText('Amount', colXs.amt + 6, headerTextY, small, true, textColor);
  y -= headerH;

  const rowLineH = body + 1.5;
  for (const it of items.length ? items : [{ itemId: '', item: '-', quantity: 0, rate: 0 } as any]) {
    const itemText = formatItemLabel(String(it.item ?? ''), (it as any)?.specificationsJson);
    const itemLines = wrapText({ text: itemText, font: fontRegular, size: body, maxWidth: colItems - 12 });
    const linesCount = Math.max(1, itemLines.length);
    const rowH = linesCount * rowLineH + 12;
    ensureSpace(rowH + 18);

    const yTop = y;
    const yText = yTop - body;

    const qtyText = formatQty(Number(it.quantity ?? 0));
    const discPct = Number(it.discountPercent ?? 0);
    const taxPct = Number(it.taxPercent ?? 0);
    const rate = Number(it.rate ?? 0);
    const rateText = Number.isFinite(rate) ? String(rate) : '';
    const base = Number.isFinite(rate) ? Number(it.quantity ?? 0) * rate : 0;
    const discAmount = Number.isFinite(discPct) && discPct > 0 ? (base * discPct) / 100 : 0;
    const taxable = base - discAmount;
    const taxAmount = Number.isFinite(taxPct) && taxPct > 0 ? (taxable * taxPct) / 100 : 0;
    const cgstAmount = showCgstSgstCols ? taxAmount / 2 : 0;
    const sgstAmount = showCgstSgstCols ? taxAmount / 2 : 0;
    const igstAmount = showIgstCol ? taxAmount : 0;

    const discText = Number.isFinite(discPct) && discPct > 0 ? `${discPct.toFixed(2)}%` : '';
    const discAmtText = showDiscCol && discAmount > 0.000001 ? formatMoney(discAmount) : '';
    const taxText = Number.isFinite(taxPct) && taxPct > 0 ? `${taxPct.toFixed(0)}%` : '';

    const totalAmount = Number(it.totalAmount ?? 0);
    const amount = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : taxable + taxAmount;
    const amtText = formatMoney(amount);

    // No borders / separators (per PDF styling requirement).

    for (let i = 0; i < itemLines.length; i++) {
      drawText(itemLines[i]!.text, colXs.items + 6, yText - i * rowLineH, body, false, textColor);
    }
    drawText(qtyText || '-', colXs.qty + 6, yText, body, false, textColor);
    drawText(rateText || '-', colXs.rate + 6, yText, body, false, textColor);
    if (showDiscCol) {
      drawText(discText, colXs.discPct + 6, yText, body, false, textColor);
      drawText(discAmtText, colXs.discAmt + 6, yText, body, false, textColor);
    }
    if (showGstCol) {
      drawText(taxText, colXs.gstRate + 6, yText, body, false, textColor);
      if (showCgstSgstCols) {
        drawText(formatMoney(cgstAmount), colXs.cgst + 6, yText, body, false, textColor);
        drawText(formatMoney(sgstAmount), colXs.sgst + 6, yText, body, false, textColor);
      }
      if (showIgstCol) {
        drawText(formatMoney(igstAmount), colXs.igst + 6, yText, body, false, textColor);
      }
    }
    drawText(amtText, colXs.amt + 6, yText, body, false, textColor);

    y -= rowH;
  }

  // Add breathing room between items table and subtotals section.
  y -= 14;

  // ===== Totals + Terms =====
  const goodsTotal = items.reduce((sum, it) => sum + Number(it.goodsAmount ?? 0), 0);
  const taxTotal = items.reduce((sum, it) => sum + Number(it.taxAmount ?? 0), 0);
  const grandTotal = items.reduce((sum, it) => sum + Number(it.totalAmount ?? 0), 0);
  const discTotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity ?? 0);
    const rate = Number(it.rate ?? 0);
    const discPct = Number(it.discountPercent ?? 0);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || !Number.isFinite(discPct) || discPct <= 0) return sum;
    const base = qty * rate;
    return sum + (base * discPct) / 100;
  }, 0);

  const tcText = String(firm?.termsConditions ?? '').trim();

  ensureSpace(180);
  y -= 6;

	  const termsX = tableX;
	  const termsW = tableW;
	  const totalsX = tableX + tableW - 210;
  const totalsW = 210;
  const yTopBlocks = y;

  // Totals (right)
  y = yTopBlocks;
  const drawAmountRow = (label: string, value: number, bold = false, color = textColor) => {
    const labelX = totalsX;
    const valueX = totalsX + totalsW - 2;
    drawText(label, labelX, y, small, false, textColor);
    const v = formatMoney(value);
    const w = (bold ? fontBold : fontRegular).widthOfTextAtSize(v, small);
    drawText(v, valueX - w, y, small, bold, color);
    y -= small + 8;
  };

  drawAmountRow('Taxable Amount', goodsTotal, false);
  if (discTotal > 0.000001) drawAmountRow('Disc', discTotal, false);
  if (taxTotal > 0.000001) {
    if (intra) {
      drawAmountRow('SGST/UTGST', taxTotal / 2, false);
      drawAmountRow('CGST', taxTotal / 2, false);
    } else if (inter) {
      drawAmountRow('IGST', taxTotal, false);
    } else {
      drawAmountRow('Tax', taxTotal, false);
    }
  }
  // No separator line (per PDF styling requirement: no borders/lines).
  y -= 4;
  drawAmountRow('Total', grandTotal, true, textColor);
  const yTotalsEnd = y;

  // Terms & conditions below totals, left side (like sample)
  y = yTotalsEnd - 8;
  ensureSpace(80);
  drawText('Terms & Conditions:', termsX, y, body, true, textColor);
  y -= 12;
  if (tcText) {
    const tcLines = wrapText({ text: tcText, font: fontRegular, size: small, maxWidth: termsW });
    for (const ln of tcLines) {
      ensureSpace(16);
      drawText(ln.text, termsX, y, small, false, textColor);
      y -= small + 3;
    }
  } else {
    drawText('-', termsX, y, small, false, muted);
    y -= small + 3;
  }

  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), filename };
}
