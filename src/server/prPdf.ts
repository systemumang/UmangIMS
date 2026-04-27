import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PrWithItems } from './sqliteStore';
import { formatDateDDMMYYYYOnly } from '../lib/date';

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

function summarizeSpec(spec: string) {
  const lines = String(spec ?? '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.join('\n');
}

function specToInline(spec: string) {
  const lines = String(spec ?? '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.join(' - ');
}

function formatQty(q: number) {
  if (!Number.isFinite(q)) return '';
  if (Math.abs(q - Math.round(q)) < 1e-9) return String(Math.round(q));
  return String(q);
}

export async function generatePurchaseRequisitionPdfBuffer(args: {
  request: PrWithItems;
  firmName?: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { request, firmName } = args;
  const pr = request.pr;
  const items = request.items ?? [];

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const A4 = { width: 595.28, height: 841.89 };
  const margin = 40;
  const lineGap = 4;
  // PDF styling requirement: black text on white, no grey colors / borders.
  const textColor = rgb(0, 0, 0);
  const muted = textColor;

  const titleSize = 16;
  const hSize = 10;
  const bodySize = 10;

  const filename = `${safeFilenamePart(pr.id || 'PR') || 'PR'}.pdf`;

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

  // Header
  const firmHeader = String(firmName ?? '').trim() || 'Purchase Requisition';
  const firmHeaderMaxW = A4.width - margin * 2;
  const firmHeaderSize = fitFontSizeToWidth({ text: firmHeader, font: fontBold, size: 22, maxWidth: firmHeaderMaxW, minSize: 12 });
  const firmHeaderW = fontBold.widthOfTextAtSize(firmHeader, firmHeaderSize);
  drawText(firmHeader, (A4.width - firmHeaderW) / 2, y, firmHeaderSize, true);

  y -= firmHeaderSize + 8;

  const title = 'Purchase Requisition';
  const finalTitleSize = fitFontSizeToWidth({ text: title, font: fontBold, size: titleSize, maxWidth: firmHeaderMaxW, minSize: 12 });
  const titleW = fontBold.widthOfTextAtSize(title, finalTitleSize);
  drawText(title, (A4.width - titleW) / 2, y, finalTitleSize, true);

  y -= finalTitleSize + 12;
  y -= 18;

  drawKeyVal('PR No', pr.id, margin, y);
  drawKeyVal('Required Date', formatDateDDMMYYYYOnly(pr.requiredDate), A4.width / 2, y);
  y -= bodySize + lineGap + 4;

  drawKeyVal('Department', pr.department, margin, y);
  drawKeyVal('Requested By', pr.requestedBy, A4.width / 2, y);
  y -= bodySize + lineGap + 4;

  drawKeyVal('Status', pr.status, margin, y);
  drawKeyVal('Generated', formatDateDDMMYYYYOnly(new Date()), A4.width / 2, y);
  y -= 16;

  // Items table
  const tableX = margin;
  const tableW = A4.width - margin * 2;
  const colQty = 58;
  const colItem = tableW - colQty;
  const rowPadY = 6;
  const rowPadX = 6;
  const lineH = bodySize + 2;

  const drawTableHeader = () => {
    const headerH = 22;
    // No header fill or borders; keep bold black text.
    drawText('Item', tableX + rowPadX, y - 15, hSize, true, textColor);
    drawText('Qty', tableX + colItem + rowPadX, y - 15, hSize, true, textColor);
    y -= headerH;
  };

  const ensureSpace = (h: number) => {
    if (y - h < margin) {
      newPage();
      drawTableHeader();
    }
  };

  drawTableHeader();

  const rows: Array<{ item: string; qty: string }> = items.map((it) => {
    const name = String(it.item ?? '').trim() || '-';
    const specInline = specToInline(summarizeSpec(it.specification));
    const itemText = specInline ? `${name} - ${specInline}` : name;
    return { item: itemText, qty: formatQty(Number(it.quantity)) || '-' };
  });

  if (!rows.length) rows.push({ item: '-', qty: '-' });

  for (const r of rows) {
    const itemLines = wrapText({ text: r.item, font: fontRegular, size: bodySize, maxWidth: colItem - rowPadX * 2 });
    const linesCount = Math.max(itemLines.length, 1);
    const rowH = rowPadY * 2 + linesCount * lineH;
    ensureSpace(rowH);

    const x1 = tableX + colItem;

    const textYStart = y - rowPadY - bodySize;
    drawText(r.qty, x1 + rowPadX, textYStart, bodySize);

    for (let i = 0; i < itemLines.length; i++) {
      drawText(itemLines[i]!.text, tableX + rowPadX, textYStart - i * lineH, bodySize);
    }

    y -= rowH;
  }

  // Footer notes
  const note = 'This is a system-generated document.';
  ensureSpace(34);
  y -= 14;
  drawText(note, margin, y, 9, false, muted);

  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), filename };
}
