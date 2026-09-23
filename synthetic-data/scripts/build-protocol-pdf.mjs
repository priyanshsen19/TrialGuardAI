// Renders synthetic-data/protocols/CT-2026-001.txt into a paginated PDF
// (one PDF page per "=== PAGE n ===" block) so the demo exercises real PDF
// parsing with page-level provenance.
import { createWriteStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../protocols/CT-2026-001.txt');
const out = join(here, '../protocols/CT-2026-001.pdf');
const text = readFileSync(src, 'utf8');
const parts = text.split(/^=== PAGE (\d+) ===$/m).slice(1);

const doc = new PDFDocument({ size: 'LETTER', margin: 54, autoFirstPage: false, info: { Title: 'CT-2026-001 Synthetic Protocol', Author: 'TrialGuard AI synthetic data generator', Subject: 'SYNTHETIC - FOR DEMONSTRATION ONLY' } });
doc.pipe(createWriteStream(out));
for (let i = 0; i < parts.length; i += 2) {
  doc.addPage();
  const lines = parts[i + 1].trim().split('\n');
  for (const line of lines) {
    if (/^CT-\d{4}-\d{3} \|/.test(line)) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text(line, { width: 504 });
      doc.moveDown(0.8);
    } else if (/^Page \d+ of \d+/.test(line)) {
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // footer sits inside the margin; don't trigger a page break
      doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text(line, 54, 752, { width: 504, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    } else if (/^\d+(\.\d+)*\s+[A-Z]/.test(line)) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11).fillColor('#0b1f3a').text(line, { width: 504 });
      doc.moveDown(0.2);
    } else if (line.trim() === '') {
      doc.moveDown(0.5);
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor('#111111').text(line, { width: 504 });
      doc.moveDown(0.15);
    }
  }
}
doc.end();
console.log(`wrote ${out}`);
