import { Router } from 'express';
import multer from 'multer';
import { createRequire } from 'module';
import { prisma } from '../db.js';
import { chunkText } from '../services/chunker.js';
import { saveChunk } from '../services/rag.js';
import { getChatClient, getChatModel } from '../services/llm.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

function inferExamType(source) {
  const s = String(source || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (s.includes('aws') || s.includes('saa')) return 'AWS SAA';
  if (s.includes('sqld')) return 'SQLD';
  if (s.includes('리눅스') || s.includes('linux')) return '리눅스마스터 2급';
  if (s.includes('adsp')) return 'ADsP';
  if (s.includes('정보처리기사') || s.includes('기사')) return '정보처리기사';
  return '';
}

function parseTopicArray(raw) {
  const text = String(raw || '').trim();
  const codeBlock = text.replace(/```json|```/gi, '').trim();
  const arrStart = codeBlock.indexOf('[');
  const arrEnd = codeBlock.lastIndexOf(']');
  const candidate = arrStart !== -1 && arrEnd > arrStart ? codeBlock.slice(arrStart, arrEnd + 1) : codeBlock;
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) throw new Error('topics 응답이 배열이 아닙니다.');
  return parsed
    .map((x) => String(x || '').trim())
    .filter((x) => x.length >= 2 && x.length <= 40)
    .slice(0, 12);
}

async function inferTopicsWithLlm(source) {
  const chunks = await prisma.chunk.findMany({
    select: { content: true },
    where: { source },
    take: 40,
  });
  const context = chunks.map((c) => c.content).join('\n\n').slice(0, 12000);
  if (!context.trim()) return [];

  const prompt = `다음은 자격증 학습 PDF에서 추출한 텍스트입니다.
이 텍스트를 보고 학습 과목/토픽 이름만 5~12개 추려서 JSON 배열로만 출력하세요.
설명 문장 금지. 배열 외 텍스트 금지.

예시 출력:
["데이터베이스","운영체제","네트워크"]

[텍스트]
${context}`;

  const res = await getChatClient().chat.completions.create({
    model: getChatModel(),
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
  });

  const raw = res.choices[0]?.message?.content || '[]';
  return parseTopicArray(raw);
}

export const uploadRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

uploadRouter.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'PDF 파일이 필요합니다.' });

    const parsed = await pdfParse(req.file.buffer);
    const text = parsed.text || '';
    const source = req.body?.sourceName || req.file.originalname || 'upload.pdf';
    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i += 1) {
      await saveChunk({ content: chunks[i], source, page: i + 1 });
    }

    res.json({ ok: true, source, chunkCount: chunks.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '업로드 실패' });
  }
});

uploadRouter.get('/sources', async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT DISTINCT source FROM "Chunk" ORDER BY source');
    const sources = rows.map((r) => r.source).filter(Boolean);

    const sourceExamType = {};
    for (const s of sources) {
      const examGuess = inferExamType(s) || '';
      sourceExamType[s] = examGuess;
    }
    const examTypeOptions = Array.from(new Set(Object.values(sourceExamType).filter(Boolean)));
    if (sources.length > 0 && examTypeOptions.length === 0) examTypeOptions.push('기타');

    res.json({
      sources,
      examTypeOptions,
      sourceExamType,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'sources 조회 실패' });
  }
});

uploadRouter.get('/sources/stats', async (_req, res) => {
  try {
    const grouped = await prisma.chunk.groupBy({
      by: ['source'],
      _count: { _all: true },
      _max: { page: true },
      orderBy: { source: 'asc' },
    });

    const files = grouped.map((row) => ({
      source: row.source,
      chunkCount: row._count?._all || 0,
      maxPage: row._max?.page || 0,
      examType: inferExamType(row.source) || '기타',
    }));

    res.json({ files, totalFiles: files.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'sources stats 조회 실패' });
  }
});

uploadRouter.get('/sources/topics', async (req, res) => {
  try {
    const source = String(req.query?.source || '').trim();
    if (!source) return res.status(400).json({ error: 'source 파라미터가 필요합니다.' });
    const topics = await inferTopicsWithLlm(source);
    res.json({ source, topics });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'topics 추출 실패' });
  }
});

uploadRouter.get('/sources/metadata', async (req, res) => {
  try {
    const source = String(req.query?.source || '').trim();
    const limit = Math.min(Math.max(Number(req.query?.limit || 5), 1), 20);
    if (!source) return res.status(400).json({ error: 'source 파라미터가 필요합니다.' });

    const [agg, samples] = await Promise.all([
      prisma.chunk.aggregate({
        where: { source },
        _count: { _all: true },
        _min: { page: true },
        _max: { page: true },
      }),
      prisma.chunk.findMany({
        where: { source },
        select: { id: true, page: true, content: true },
        orderBy: { page: 'asc' },
        take: limit,
      }),
    ]);

    const sampleChunks = samples.map((row) => ({
      id: row.id,
      page: row.page,
      preview: String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    }));

    res.json({
      source,
      chunkCount: agg._count?._all || 0,
      minPage: agg._min?.page || 0,
      maxPage: agg._max?.page || 0,
      sampleChunks,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'metadata 조회 실패' });
  }
});

uploadRouter.get('/sources/chunks', async (req, res) => {
  try {
    const source = String(req.query?.source || '').trim();
    const limit = Math.min(Math.max(Number(req.query?.limit || 30), 1), 100);
    const offset = Math.max(Number(req.query?.offset || 0), 0);
    if (!source) return res.status(400).json({ error: 'source 파라미터가 필요합니다.' });

    const [rows, total] = await Promise.all([
      prisma.chunk.findMany({
        where: { source },
        select: { id: true, page: true, content: true },
        orderBy: [{ page: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.chunk.count({ where: { source } }),
    ]);

    const chunks = rows.map((row) => ({
      id: row.id,
      page: row.page,
      preview: String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    }));

    res.json({ source, total, limit, offset, chunks });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'chunks 조회 실패' });
  }
});
