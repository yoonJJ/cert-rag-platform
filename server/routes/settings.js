import { Router } from 'express';
import {
  getChatOptions,
  setChatModel,
  setOpenaiApiKey,
  hasOpenaiApiKey,
  getOpenaiKeyHint,
  getLlmSettingsSnapshot,
  checkLLMHealth,
} from '../services/llm.js';

export const settingsRouter = Router();

settingsRouter.get('/settings/llm', async (_req, res) => {
  try {
    const health = await checkLLMHealth();
    const snap = getLlmSettingsSnapshot();
    res.json({
      model: snap.optionId,
      apiModel: snap.apiModel,
      label: snap.label,
      provider: snap.provider,
      options: getChatOptions(),
      hasOpenAiKey: hasOpenaiApiKey(),
      openaiKeyHint: getOpenaiKeyHint(),
      llmOk: health.ok,
      llmState: health.state,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'settings error' });
  }
});

settingsRouter.put('/settings/llm', (req, res) => {
  try {
    const { model, openaiApiKey } = req.body || {};

    if (openaiApiKey !== undefined) {
      setOpenaiApiKey(openaiApiKey);
    }

    if (model !== undefined && model !== null && String(model).trim() !== '') {
      setChatModel(model);
    }

    const snap = getLlmSettingsSnapshot();
    res.json({
      model: snap.optionId,
      apiModel: snap.apiModel,
      label: snap.label,
      provider: snap.provider,
      hasOpenAiKey: hasOpenaiApiKey(),
      openaiKeyHint: getOpenaiKeyHint(),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid settings' });
  }
});
