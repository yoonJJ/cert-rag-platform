import { Router } from 'express';
import { prisma } from '../db.js';
import { generateQuestions, searchChunksDebug } from '../services/rag.js';

export const questionsRouter = Router();

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
          answer: Number(q.answer),
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
    res.status(500).json({ error: e.message || '문제 생성 실패' });
  }
});
