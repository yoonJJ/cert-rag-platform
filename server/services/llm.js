import OpenAI from 'openai';

export const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
});

export const EMBED_MODEL = 'nomic-embed-text';

function loadChatModelOptions() {
  const raw = process.env.OLLAMA_CHAT_MODELS?.trim();
  if (raw) {
    const parsed = raw.split(',').map((segment) => {
      const s = segment.trim();
      const pipe = s.indexOf('|');
      if (pipe === -1) return { id: s, label: s };
      const id = s.slice(0, pipe).trim();
      const label = s.slice(pipe + 1).trim() || id;
      return { id, label };
    }).filter((o) => o.id);
    if (parsed.length) return parsed;
  }
  return [
    { id: 'gpt-oss:20b', label: 'GPT-OSS 20B' },
    { id: 'gemma4:26b', label: 'Gemma 4 26B' },
  ];
}

const CHAT_MODEL_OPTIONS = loadChatModelOptions();
const optionIds = new Set(CHAT_MODEL_OPTIONS.map((o) => o.id));

function pickInitialModel() {
  const fromEnv = process.env.CHAT_MODEL?.trim();
  if (fromEnv && optionIds.has(fromEnv)) return fromEnv;
  return CHAT_MODEL_OPTIONS[0]?.id || 'gpt-oss:20b';
}

let currentChatModel = pickInitialModel();

export function getChatModelOptions() {
  return CHAT_MODEL_OPTIONS;
}

export function getChatModel() {
  return currentChatModel;
}

export function setChatModel(modelId) {
  const id = String(modelId || '').trim();
  if (!id || !optionIds.has(id)) {
    throw new Error(`지원하지 않는 모델입니다. 선택 가능: ${[...optionIds].join(', ')}`);
  }
  currentChatModel = id;
  return currentChatModel;
}

export function getChatModelLabel(modelId = currentChatModel) {
  const found = CHAT_MODEL_OPTIONS.find((o) => o.id === modelId);
  return found?.label || modelId;
}

export async function checkLLMHealth() {
  const startedAt = Date.now();
  const model = getChatModel();
  try {
    await client.models.list();
    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      state: latencyMs > 1200 ? 'degraded' : 'connected',
      latencyMs,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - startedAt,
      model,
      error: err instanceof Error ? err.message : 'LLM health check failed',
    };
  }
}
