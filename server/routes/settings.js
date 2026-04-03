import { Router } from 'express';
import {
  getChatModel,
  getChatModelLabel,
  getChatModelOptions,
  setChatModel,
  checkLLMHealth,
} from '../services/llm.js';

export const settingsRouter = Router();

settingsRouter.get('/settings/llm', async (_req, res) => {
  try {
    const health = await checkLLMHealth();
    const model = getChatModel();
    res.json({
      model,
      label: getChatModelLabel(model),
      options: getChatModelOptions(),
      llmOk: health.ok,
      llmState: health.state,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'settings error' });
  }
});

settingsRouter.put('/settings/llm', (req, res) => {
  try {
    const { model } = req.body || {};
    setChatModel(model);
    const next = getChatModel();
    res.json({ model: next, label: getChatModelLabel(next) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid model' });
  }
});
