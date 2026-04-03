import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import { client, getChatModel, EMBED_MODEL } from './llm.js';

export async function embed(text) {
  const res = await client.embeddings.create({ model: EMBED_MODEL, input: text });
  return res.data[0].embedding;
}

export async function saveChunk({ content, source, page }) {
  const vec = await embed(content);
  await prisma.$executeRawUnsafe(
    'INSERT INTO "Chunk" (id, content, embedding, source, page) VALUES ($1, $2, $3::vector, $4, $5)',
    randomUUID(),
    content,
    `[${vec.join(',')}]`,
    source,
    page,
  );
}

export async function retrieveChunks(query, topK = 5, source = '') {
  const queryVec = await embed(query);
  const vector = `[${queryVec.join(',')}]`;
  let rows = [];

  if (source) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT content, source, page
         FROM "Chunk"
        WHERE source = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      vector,
      source,
      Number(topK),
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `SELECT content, source, page
         FROM "Chunk"
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      vector,
      Number(topK),
    );
  }

  return rows.map((r) => ({ content: r.content, source: r.source, page: r.page }));
}

export async function searchChunksDebug(query, topK = 5, source = '') {
  const queryVec = await embed(query);
  const vector = `[${queryVec.join(',')}]`;
  const limit = Math.min(Math.max(Number(topK || 5), 1), 20);
  let rows = [];

  if (source) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, source, page, content, (embedding <=> $1::vector) AS distance
         FROM "Chunk"
        WHERE source = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      vector,
      source,
      limit,
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, source, page, content, (embedding <=> $1::vector) AS distance
         FROM "Chunk"
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      vector,
      limit,
    );
  }

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    page: r.page,
    distance: Number(r.distance),
    preview: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 240),
  }));
}

function formatSourceDoc(chunks, { maxFiles = 3, maxPagesPerFile = 8 } = {}) {
  const bySource = new Map();

  for (const c of chunks) {
    const key = c.source || 'unknown';
    if (!bySource.has(key)) bySource.set(key, new Set());
    if (typeof c.page === 'number') bySource.get(key).add(c.page);
  }

  const parts = [];
  const entries = Array.from(bySource.entries());

  for (const [source, pageSet] of entries.slice(0, maxFiles)) {
    const pages = Array.from(pageSet).sort((a, b) => a - b);
    const limited = pages.slice(0, maxPagesPerFile);
    const suffix = pages.length > maxPagesPerFile ? ', …' : '';
    parts.push(`${source} (p.${limited.join(', ')}${suffix})`);
  }

  if (!parts.length) return 'unknown';
  return parts.join(' · ');
}

export async function retrieve(query, topK = 5) {
  const queryVec = await embed(query);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT content, 1 - (embedding <=> $1::vector) AS similarity
       FROM "Chunk"
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    `[${queryVec.join(',')}]`,
    Number(topK),
  );
  return rows.map((r) => r.content).join('\n\n');
}

function extractJsonCandidate(raw) {
  const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

function parseQuestions(raw) {
  const candidate = extractJsonCandidate(raw);
  const parsed = JSON.parse(candidate || '{}');
  if (!Array.isArray(parsed.questions)) throw new Error('questions 배열이 없습니다.');
  return parsed.questions;
}

async function callQuestionsModel(prompt, maxRetry = 1) {
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const res = await client.chat.completions.create({
      model: getChatModel(),
      messages: [{ role: 'user', content: prompt }],
      // 잘리는 경우를 줄이기 위해 여유를 조금 더 둡니다.
      max_tokens: 2600,
    });

    const raw = res.choices[0]?.message?.content || '';
    try {
      return parseQuestions(raw);
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetry) continue;
    }
  }

  throw new Error(`문제 JSON 파싱 실패: ${lastErr?.message || 'unknown'}`);
}

export async function generateQuestions(topic, examType, count = 5, source = '') {
  const chunks = await retrieveChunks(topic, 5, source);
  const context = chunks.map((c) => c.content).join('\n\n');
  const sourceDoc = formatSourceDoc(chunks);
  const prompt = `당신은 IT 자격증 시험 출제 전문가입니다.
아래 내용을 바탕으로 ${examType} 시험 스타일의 문제를 ${count}개 생성하세요.

[참고 내용]
${context}

출력 형식(JSON만):
{
  "questions": [
    {
      "question": "문제 텍스트",
      "options": ["①", "②", "③", "④"],
      "answer": 2,
      "explanation": "해설",
      "topic": "토픽",
      "difficulty": "상|중|하"
    }
  ]
}`;

  const items = await callQuestionsModel(prompt, 1);
  return items.map((q) => ({ ...q, sourceDoc }));
}

export async function generateSimilarQuestions(wrongAnswer, count = 3) {
  const chunks = await retrieveChunks(wrongAnswer.topic, 3);
  const context = chunks.map((c) => c.content).join('\n\n');
  const sourceDoc = formatSourceDoc(chunks);
  const prompt = `학습자가 틀린 문제:
문제: ${wrongAnswer.question}
정답: ${wrongAnswer.correctAnswer}번
토픽: ${wrongAnswer.topic}

같은 개념을 다른 각도로 묻는 유사 문제 ${count}개를 JSON으로 생성하세요.

[참고 내용]
${context}`;

  const items = await callQuestionsModel(prompt, 1);
  return items.map((q) => ({ ...q, sourceDoc }));
}
