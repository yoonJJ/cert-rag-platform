import { Router } from 'express';
import { prisma } from '../db.js';
import { generateQuestions, searchChunksDebug } from '../services/rag.js';
import { getLlmSettingsSnapshot } from '../services/llm.js';

export const questionsRouter = Router();

function normalizeAnswerIndex(answer, options) {
  const size = Array.isArray(options) ? options.length : 0;
  const n = Number(answer);
  if (!Number.isFinite(n)) return 0;
  if (size > 0 && n >= 0 && n < size) return n;
  if (size > 0 && n >= 1 && n <= size) return n - 1;
  return Math.max(0, n);
}

questionsRouter.get('/vector/search', async (req, res) => {
  try {
    const query = String(req.query?.query || '').trim();
    const source = String(req.query?.source || '').trim();
    const topK = Number(req.query?.topK || 5);
    if (!query) return res.status(400).json({ error: 'query 파라미터가 필요합니다.' });

    const rows = await searchChunksDebug(query, topK, source);
    res.json({ query, source, topK: Math.min(Math.max(topK, 1), 20), results: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '벡터 검색 실패' });
  }
});

questionsRouter.post('/questions/generate', async (req, res) => {
  try {
    const { topic, command, examType, count = 5, source = '' } = req.body || {};
    const resolvedTopic = String(command || topic || '').trim();
    if (!resolvedTopic || !examType) return res.status(400).json({ error: 'examType, command 필요' });

    const generated = await generateQuestions(resolvedTopic, examType, Number(count), source);
    const questions = [];

    for (const q of generated) {
      const saved = await prisma.question.create({
        data: {
          content: q.question,
          options: q.options,
          answer: normalizeAnswerIndex(q.answer, q.options),
          explanation: q.explanation || '',
          topic: q.topic || resolvedTopic,
          difficulty: q.difficulty || '중',
          examType,
          sourceDoc: q.sourceDoc || 'rag-generated',
        },
      });

      questions.push({
        id: saved.id,
        question: saved.content,
        options: saved.options,
        answer: saved.answer,
        explanation: saved.explanation,
        topic: saved.topic,
        sourceDoc: saved.sourceDoc,
      });
    }

    res.json({ questions });
  } catch (e) {
    console.error(e);
    const llm = getLlmSettingsSnapshot();
    if (e?.status === 404) {
      return res.status(404).json({
        error: `현재 모델 호출 경로를 찾지 못했습니다(404). 모델/프로바이더 설정을 확인해 주세요: ${llm.label} (${llm.provider}/${llm.apiModel}).`,
      });
    }
    if (e?.status === 429) {
      return res.status(429).json({
        error: `요청 한도(429)를 초과했습니다. 현재 모델: ${llm.label} (${llm.provider}/${llm.apiModel}). 잠시 후 다시 시도하거나 다른 모델로 변경해 주세요.`,
      });
    }
    res.status(500).json({ error: e.message || '문제 생성 실패' });
  }
});
