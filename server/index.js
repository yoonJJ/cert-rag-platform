import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './db.js';
import { uploadRouter } from './routes/upload.js';
import { questionsRouter } from './routes/questions.js';
import { examRouter } from './routes/exam.js';
import { tutorRouter } from './routes/tutor.js';
import { wrongRouter } from './routes/wrong.js';
import { settingsRouter } from './routes/settings.js';
import { checkLLMHealth } from './services/llm.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (_req, res) => {
  const dbStartedAt = Date.now();
  let dbStatus;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = {
      ok: true,
      state: 'connected',
      latencyMs: Date.now() - dbStartedAt,
    };
  } catch {
    dbStatus = {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - dbStartedAt,
    };
  }

  const llmStatus = await checkLLMHealth();
  res.json({
    ok: dbStatus.ok && llmStatus.ok,
    db: dbStatus.ok,
    llm: llmStatus.ok,
    dbStatus,
    llmStatus,
  });
});

app.use('/api', uploadRouter);
app.use('/api', questionsRouter);
app.use('/api', examRouter);
app.use('/api', tutorRouter);
app.use('/api', wrongRouter);
app.use('/api', settingsRouter);

async function bootstrap() {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
  app.listen(PORT, () => console.log(`API: http://localhost:${PORT}`));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
