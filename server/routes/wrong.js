import { Router } from 'express';
import { prisma } from '../db.js';
import { generateSimilarQuestions } from '../services/rag.js';

export const wrongRouter = Router();

wrongRouter.get('/wrong', async (_req, res) => {
  const items = await prisma.wrongAnswer.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ items });
});

wrongRouter.post('/wrong', async (req, res) => {
  const b = req.body || {};
  const row = await prisma.wrongAnswer.create({
    data: {
      question: b.question,
      options: b.options,
      myAnswer: Number(b.myAnswer),
      correctAnswer: Number(b.correctAnswer),
      explanation: b.explanation || '',
      topic: b.topic || '',
      examType: b.examType || '',
    },
  });
  res.json(row);
});

wrongRouter.delete('/wrong/:id', async (req, res) => {
  await prisma.wrongAnswer.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});

wrongRouter.post('/wrong/:id/similar', async (req, res) => {
  const row = await prisma.wrongAnswer.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'not found' });

  try {
    const questions = await generateSimilarQuestions(row, Number(req.body?.count || 3));
    res.json({ questions });
  } catch (e) {
    res.status(500).json({ error: e.message || '유사 문제 생성 실패' });
  }
});
