import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { cleanText, MAX_TEXT } from '../shared/core.js';

const MAX_FILE_BYTES = 8_000_000;
const MAX_FILES = 10;
const TYPES = new Set(['txt', 'md', 'csv', 'json', 'pdf', 'docx']);

export async function readCareerFiles(filePaths, kind = 'resume') {
  const documents = [];
  for (const filePath of filePaths.slice(0, MAX_FILES)) {
    const realPath = await fs.realpath(filePath);
    const extension = path.extname(realPath).toLowerCase().slice(1);
    if (!TYPES.has(extension)) continue;
    const stat = await fs.stat(realPath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    let text = '';
    if (['txt', 'md', 'csv', 'json'].includes(extension)) text = await fs.readFile(realPath, 'utf8');
    if (extension === 'docx') text = (await mammoth.extractRawText({ path: realPath })).text;
    if (extension === 'pdf') {
      const parser = new PDFParse({ data: await fs.readFile(realPath) });
      try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
    }
    text = text.replace(/\u0000/g, '').replace(/[^\S\r\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
    if (!text) continue;
    documents.push({ id: `document-${Date.now().toString(36)}-${documents.length}`, name: cleanText(path.basename(realPath), 200), text, kind: kind === 'response' ? 'response' : 'resume' });
  }
  return documents;
}
