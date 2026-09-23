/**
 * Document intake: file validation + page-level text extraction.
 * PDFs are parsed page by page so every criterion/fact keeps page provenance.
 */
import { AppError } from '../common/errors';

// pdf-parse's index.js runs a self-test when required directly; import the library entry.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ numpages: number; text: string }> = require('pdf-parse/lib/pdf-parse.js');

export const ALLOWED_MIME = ['application/pdf', 'text/plain', 'text/markdown'];

export interface ParsedDocument {
  documentName: string;
  mimeType: string;
  pages: Array<{ page: number; text: string }>;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'document';
}

export function validateUpload(buf: Buffer, mimeType: string, maxBytes: number) {
  if (!buf.length) throw new AppError('EMPTY_FILE', 'Uploaded file is empty');
  if (buf.length > maxBytes) throw new AppError('FILE_TOO_LARGE', `File exceeds ${maxBytes} bytes`, 413);
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (mimeType === 'application/pdf' && !isPdf) throw new AppError('INVALID_FILE', 'File declared as PDF but does not have a PDF signature');
  if (!ALLOWED_MIME.includes(mimeType) && !isPdf) throw new AppError('UNSUPPORTED_FILE_TYPE', `Unsupported file type ${mimeType}; allowed: PDF, plain text`);
  if (!isPdf) {
    if (buf.includes(0)) throw new AppError('INVALID_FILE', 'Text file contains binary content');
    const text = buf.toString('utf8');
    if (text.includes('�')) throw new AppError('INVALID_FILE', 'Text file is not valid UTF-8');
  }
  return isPdf ? 'application/pdf' : 'text/plain';
}

/** Split plain text into pages on "=== PAGE n ===" markers (or form feeds); otherwise one page. */
export function splitTextPages(text: string): Array<{ page: number; text: string }> {
  const marker = /^=+\s*PAGE\s+(\d+)\s*=+\s*$/gim;
  const parts = text.split(marker);
  if (parts.length > 1) {
    const pages: Array<{ page: number; text: string }> = [];
    for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1].trim() });
    return pages;
  }
  const ff = text.split('\f');
  return ff.map((t, i) => ({ page: i + 1, text: t.trim() })).filter((p) => p.text.length > 0);
}

export async function extractPdfPages(buf: Buffer): Promise<Array<{ page: number; text: string }>> {
  const pages: string[] = [];
  await pdfParse(buf, {
    max: 500,
    pagerender: async (pageData: { getTextContent: (o: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: number | undefined;
      let text = '';
      for (const item of content.items) {
        const y = item.transform[5];
        if (lastY === undefined || Math.abs(y - lastY) < 1) text += item.str;
        else text += '\n' + item.str;
        lastY = y;
      }
      pages.push(text);
      return text;
    },
  });
  return pages.map((t, i) => ({ page: i + 1, text: t.trim() }));
}

export async function parseDocument(buf: Buffer, filename: string, mimeType: string, maxBytes: number): Promise<ParsedDocument> {
  const effective = validateUpload(buf, mimeType, maxBytes);
  const documentName = sanitizeFilename(filename);
  if (effective === 'application/pdf') {
    let pages: Array<{ page: number; text: string }>;
    try {
      pages = await extractPdfPages(buf);
    } catch {
      throw new AppError('PDF_PARSE_FAILED', 'Could not extract text from PDF');
    }
    if (!pages.some((p) => p.text.length)) throw new AppError('PDF_NO_TEXT', 'PDF contains no extractable text (scanned PDFs require OCR, not supported)');
    return { documentName, mimeType: effective, pages };
  }
  return { documentName, mimeType: effective, pages: splitTextPages(buf.toString('utf8')) };
}
