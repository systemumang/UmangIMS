import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PoWithItems } from './sqliteStore';
import { formatDateDDMMYYYY } from '../lib/date';

type WrapLine = { text: string; width: number };

function wrapText(args: { text: string; font: any; size: number; maxWidth: number }): WrapLine[] {
  const { text, font, size, maxWidth } = args;
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function fitFontSizeToWidth(args: { text: string; font: any; size: number; maxWidth: number; minSize?: number }) {
  const { text, font, size, maxWidth, minSize = 10 } = args;
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
  return s;
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

export async function generatePurchaseOrderPdfBuffer(args: {
  po: PoWithItems;
  firmName?: string;
  orderDate?: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { po, firmName, orderDate } = args;
  const headerFirm = String(firmName ?? '').trim() || 'Purchase Order';

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const A4 = { width: 595.28, height: 841.89 };
  const margin = 40;
  const lineGap = 4;
  const textColor = rgb(0.08, 0.1, 0.12);
  const muted = rgb(0.35, 0.38, 0.42);
  const border = rgb(0.78, 0.8, 0.84);

  const hSize = 10;
  const bodySize = 10;

  const filename = `${safeFilenamePart(po.po.id || 'PO') || 'PO'}.pdf`;

  let page = pdfDoc.addPage([A4.width, A4.height]);
  let y = A4.height - margin;

  const drawText = (t: string, x: number, yPos: number, size: number, bold = false, color = textColor) => {
    page.drawText(String(t ?? ''), { x, y: yPos, size, font: bold ? fontBold : fontRegular, color });
  };

  const drawKeyVal = (label: string, value: string, x: number, yPos: number) => {
    const labelText = `${label}:`;
    drawText(labelText, x, yPos, hSize, true, muted);
    const labelW = fontBold.widthOfTextAtSize(labelText, hSize) + 6;
    drawText(value || '-', x + labelW, yPos, bodySize, false, textColor);
  };

  const newPage = () => {
    page = pdfDoc.addPage([A4.width, A4.height]);
    y = A4.height - margin;
  };

  const headerMaxW = A4.width - margin * 2;
  const firmHeaderSize = fitFontSizeToWidth({ text: headerFirm, font: fontBold, size: 24, maxWidth: headerMaxW, minSize: 12 });
  const firmHeaderW = fontBold.widthOfTextAtSize(headerFirm, firmHeaderSize);
  drawText(headerFirm, (A4.width - firmHeaderW) / 2, y, firmHeaderSize, true);

  y -= firmHeaderSize + 8;

  const title = 'Purchase Order';
  const titleSize = fitFontSizeToWidth({ text: title, font: fontBold, size: 16, maxWidth: headerMaxW, minSize: 12 });
  const titleW = fontBold.widthOfTextAtSize(title, titleSize);
  drawText(title, (A4.width - titleW) / 2, y, titleSize, true);

  y -= titleSize + 12;
  page.drawLine({ start: { x: margin, y }, end: { x: A4.width - margin, y }, thickness: 1, color: border });
  y -= 18;

  drawKeyVal('PO No', po.po.id, margin, y);
  drawKeyVal('PR No', po.po.prId, A4.width / 2, y);
  y -= bodySize + lineGap + 4;

  drawKeyVal('Supplier', po.po.supplier, margin, y);
  drawKeyVal('Order Date', formatDateDDMMYYYY(orderDate || po.po.createdAt || new Date()), A4.width / 2, y);
  y -= bodySize + lineGap + 4;

  drawKeyVal('Payment Terms', po.po.paymentTerms, margin, y);
  drawKeyVal('Generated', formatDateDDMMYYYY(new Date()), A4.width / 2, y);
  y -= 16;

  // Items table
  const tableX = margin;
  const tableW = A4.width - margin * 2;
  const colQty = 58;
  const colRate = 70;
  const colItem = tableW - colQty - colRate;
  const rowPadY = 6;
  const rowPadX = 6;
  const lineH = bodySize + 2;

  const drawTableHeader = () => {
    const headerH = 22;
    page.drawRectangle({
      x: tableX,
      y: y - headerH,
      width: tableW,
      height: headerH,
      borderColor: border,
      borderWidth: 1,
      color: rgb(0.95, 0.96, 0.98),
    });
    drawText('Item', tableX + rowPadX, y - 15, hSize, true, muted);
    drawText('Qty', tableX + colItem + rowPadX, y - 15, hSize, true, muted);
    drawText('Rate', tableX + colItem + colQty + rowPadX, y - 15, hSize, true, muted);
    y -= headerH;
  };

  const ensureSpace = (h: number) => {
    if (y - h < margin) {
      newPage();
      drawTableHeader();
    }
  };

  drawTableHeader();

  const rows: Array<{ item: string; qty: string; rate: string }> = (po.items ?? []).map((it) => ({
    item: String(it.item ?? '').trim() || '-',
    qty: formatQty(Number(it.quantity)) || '-',
    rate: formatQty(Number(it.rate)) || '-',
  }));
  if (!rows.length) rows.push({ item: '-', qty: '-', rate: '-' });

  for (const r of rows) {
    const itemLines = wrapText({ text: r.item, font: fontRegular, size: bodySize, maxWidth: colItem - rowPadX * 2 });
    const linesCount = Math.max(itemLines.length, 1);
    const rowH = rowPadY * 2 + linesCount * lineH;
    ensureSpace(rowH);

    page.drawRectangle({ x: tableX, y: y - rowH, width: tableW, height: rowH, borderColor: border, borderWidth: 1 });
    const x1 = tableX + colItem;
    const x2 = tableX + colItem + colQty;
    page.drawLine({ start: { x: x1, y: y }, end: { x: x1, y: y - rowH }, thickness: 1, color: border });
    page.drawLine({ start: { x: x2, y: y }, end: { x: x2, y: y - rowH }, thickness: 1, color: border });

    const textYStart = y - rowPadY - bodySize;
    drawText(r.qty, x1 + rowPadX, textYStart, bodySize);
    drawText(r.rate, x2 + rowPadX, textYStart, bodySize);
    for (let i = 0; i < itemLines.length; i++) drawText(itemLines[i]!.text, tableX + rowPadX, textYStart - i * lineH, bodySize);

    y -= rowH;
  }

  const note = 'This is a system-generated document.';
  ensureSpace(34);
  y -= 14;
  drawText(note, margin, y, 9, false, muted);

  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), filename };
}

