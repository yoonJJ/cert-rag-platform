import { Router } from 'express';
import { prisma } from '../db.js';

export const examRouter = Router();

examRouter.post('/exam/grade', async (req, res) => {
  const { questions, answers, examType = 'PDF기반', source = '', command = '' } = req.body || {};
  if (!Array.isArray(questions) || !answers) return res.status(400).json({ error: 'questions, answers 필요' });

  let correct = 0;
  const details = questions.map((q, idx) => {
    const picked = answers[q.id];
    const ok = picked === q.answer;
    if (ok) correct += 1;
    return {
      id: q.id,
      orderNo: idx + 1,
      correct: ok,
      picked: typeof picked === 'number' ? picked : -1,
      answer: Number(q.answer),
      question: q.question || '',
      options: Array.isArray(q.options) ? q.options : [],
      explanation: q.explanation || '',
      topic: q.topic || '',
      sourceDoc: q.sourceDoc || '',
    };
  });

  const percent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  try {
    const attempt = await prisma.examAttempt.create({
      data: {
        examType: String(examType || 'PDF기반'),
        source: String(source || ''),
        command: String(command || ''),
        total: questions.length,
        correct,
        percent,
        items: {
          create: details.map((d) => ({
            orderNo: d.orderNo,
            questionId: String(d.id || ''),
            question: d.question,
            options: d.options,
            picked: d.picked,
            answer: d.answer,
            isCorrect: d.correct,
            explanation: d.explanation,
            topic: d.topic,
            sourceDoc: d.sourceDoc,
          })),
        },
      },
    });
    res.json({ correct, total: questions.length, percent, details, attemptId: attempt.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '시험 결과 저장 실패' });
  }
});

examRouter.get('/exam/attempts', async (_req, res) => {
  try {
    const attempts = await prisma.examAttempt.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        examType: true,
        source: true,
        command: true,
        total: true,
        correct: true,
        percent: true,
        createdAt: true,
      },
      take: 100,
    });
    res.json({ attempts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '시험 이력 조회 실패' });
  }
});

examRouter.get('/exam/attempts/:id', async (req, res) => {
  try {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          orderBy: { orderNo: 'asc' },
          select: {
            id: true,
            orderNo: true,
            question: true,
            options: true,
            picked: true,
            answer: true,
            isCorrect: true,
            explanation: true,
            topic: true,
            sourceDoc: true,
          },
        },
      },
    });
    if (!attempt) return res.status(404).json({ error: 'attempt not found' });
    res.json({ attempt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '시험 상세 조회 실패' });
  }
});
