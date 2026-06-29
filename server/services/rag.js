import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import { getEmbedClient, createChatCompletion, EMBED_MODEL, EMBED_DIMENSIONS } from './llm.js';

export async function embed(text) {
  const res = await getEmbedClient().embeddings.create({
    model: EMBED_MODEL,
    input: text,
    dimensions: EMBED_DIMENSIONS,
  });
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

// 시험(과목) 모드용: 자연어 검색 없이 선택한 과목(파일) 전반에서 청크를 무작위로 추출합니다.
// 매 시험마다 다른 청크가 뽑혀 같은 과목이라도 출제 범위가 골고루 분산됩니다.
export async function sampleChunks(source, limit = 12) {
  const take = Math.min(Math.max(Number(limit) || 12, 4), 24);
  let rows = [];

  if (source) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT content, source, page
         FROM "Chunk"
        WHERE source = $1
        ORDER BY random()
        LIMIT $2`,
      source,
      take,
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `SELECT content, source, page
         FROM "Chunk"
        ORDER BY random()
        LIMIT $1`,
      take,
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
  let lastRaw = '';

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const res = await createChatCompletion({
      messages: [{ role: 'user', content: prompt }],
      // GPT-5 계열은 추론(reasoning) 토큰까지 한도에 포함되므로 응답이 잘리지 않도록 여유를 크게 둡니다.
      // (reasoning_effort=minimal 와 함께, 최대 20문항 + LaTeX 해설까지 담을 수 있게 크게 잡습니다.)
      max_tokens: 16000,
      // 유효한 JSON 객체를 강제해 파싱 실패를 줄입니다.
      response_format: { type: 'json_object' },
    });

    lastRaw = res.choices[0]?.message?.content || '';
    try {
      return parseQuestions(lastRaw);
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetry) continue;
    }
  }

  const snippet = String(lastRaw).replace(/\s+/g, ' ').trim().slice(0, 200);
  throw new Error(
    `문제 JSON 파싱 실패: ${lastErr?.message || 'unknown'}` +
      (snippet
        ? ` (모델 응답 일부: ${snippet})`
        : ' (모델 응답이 비어 있습니다 — 토큰 한도/추론으로 응답이 잘렸을 수 있습니다)'),
  );
}

export async function generateQuestions(topic, examType, count = 5, source = '') {
  const chunks = await retrieveChunks(topic, 8, source);
  const context = chunks.map((c) => c.content).join('\n\n');
  const sourceDoc = formatSourceDoc(chunks);
  const prompt = `당신은 IT 자격증 시험 출제 전문가입니다.
아래 내용을 바탕으로 ${examType} 시험 스타일의 문제를 ${count}개 생성하세요.
사용자 요청을 최우선으로 반영하되, 반드시 참고 내용에 근거해서만 출제하세요.

[참고 내용]
${context}

[사용자 요청]
${topic}

규칙:
- 사용자 요청 범위 밖의 문제를 만들지 마세요.
- 참고 내용에서 근거를 찾을 수 없는 내용은 새로 지어내지 마세요.
- 보기(options)는 반드시 4개를 생성하세요.
- answer는 보기의 정답 번호로 0~3 정수로 출력하세요.
- 수식·분수는 반드시 LaTeX로 작성하세요. 인라인은 $...$, 분수는 \\frac{분자}{분모} 형태로 쓰고 슬래시(a/b) 표기는 쓰지 마세요. (문제·보기·해설 모두 동일)

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

// 시험(과목) 모드용: 자연어 명령 없이 선택한 과목(파일) 전체를 포괄하는 모의고사를 생성합니다.
export async function generateExam(source, examType, count = 10) {
  const n = Math.min(Math.max(Number(count) || 10, 1), 20);
  const chunks = await sampleChunks(source, n + 4);
  const context = chunks.map((c) => c.content).join('\n\n');
  const sourceDoc = formatSourceDoc(chunks);
  const subject = source || '전체 자료';
  const prompt = `당신은 IT 자격증 시험 출제 전문가입니다.
아래 [참고 내용]은 "${subject}" 과목 자료에서 발췌한 것입니다.
이 과목의 모의고사 문제를 ${examType} 시험 스타일로 ${n}개 생성하세요.

[참고 내용]
${context}

규칙:
- 특정 주제에 치우치지 말고 참고 내용 전반에서 골고루 출제하세요.
- 반드시 참고 내용에 근거해서만 출제하고, 근거 없는 내용은 새로 지어내지 마세요.
- 보기(options)는 반드시 4개를 생성하세요.
- answer는 보기의 정답 번호로 0~3 정수로 출력하세요.
- 수식·분수는 반드시 LaTeX로 작성하세요. 인라인은 $...$, 분수는 \\frac{분자}{분모} 형태로 쓰고 슬래시(a/b) 표기는 쓰지 마세요. (문제·보기·해설 모두 동일)

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
