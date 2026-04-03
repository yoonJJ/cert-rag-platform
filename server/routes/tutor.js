import { Router } from 'express';
import { createChatCompletionStream } from '../services/llm.js';
import { retrieve } from '../services/rag.js';

export const tutorRouter = Router();

tutorRouter.get('/tutor', async (req, res) => {
  const { question, wrongAnswer, correctAnswer, topic } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const context = await retrieve(topic || '', 5);

    const stream = await createChatCompletionStream({
      messages: [
        {
          role: 'system',
          content: `당신은 IT 자격증 전문 튜터입니다.\n\n[참고 내용]\n${context}`,
        },
        {
          role: 'user',
          content: `문제: ${question}\n내가 고른 답: ${wrongAnswer}\n정답: ${correctAnswer}\n\n왜 틀렸는지 설명해줘.`,
        },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error(e);
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});
