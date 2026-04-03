import { Router } from 'express';
import {
  getChatOptions,
  setChatModel,
  setProviderApiKey,
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
      keyStatus: snap.keyStatus,
      keyHints: snap.keyHints,
      llmOk: health.ok,
      llmState: health.state,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'settings error' });
  }
});

settingsRouter.put('/settings/llm', (req, res) => {
  try {
    const { model, providerApiKey, keyProvider } = req.body || {};

    if (providerApiKey !== undefined) {
      const target = String(keyProvider || '').trim();
      if (!target) throw new Error('keyProvider 값이 필요합니다.');
      setProviderApiKey(target, providerApiKey);
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
      keyStatus: snap.keyStatus,
      keyHints: snap.keyHints,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid settings' });
  }
});
