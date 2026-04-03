import OpenAI from 'openai';

export const EMBED_MODEL = 'nomic-embed-text';

/** 임베딩은 항상 Ollama(nomic-embed-text) */
const embedClient = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
});

/** Ollama 전용 채팅 클라이언트(로컬) */
const ollamaChatClient = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
});

function loadOllamaOptions() {
  const raw = process.env.OLLAMA_CHAT_MODELS?.trim();
  if (raw) {
    const parsed = raw.split(',').map((segment) => {
      const s = segment.trim();
      const pipe = s.indexOf('|');
      if (pipe === -1) return { model: s, label: s };
      const model = s.slice(0, pipe).trim();
      const label = s.slice(pipe + 1).trim() || model;
      return { model, label };
    }).filter((o) => o.model);
    if (parsed.length) return parsed;
  }
  return [
    { model: 'gpt-oss:20b', label: 'GPT-OSS 20B (Ollama)' },
    { model: 'gemma4:26b', label: 'Gemma 4 26B (Ollama)' },
  ];
}

function loadOpenAiOptions() {
  const raw = process.env.OPENAI_CHAT_MODELS?.trim();
  if (raw) {
    const parsed = raw.split(',').map((segment) => {
      const s = segment.trim();
      const pipe = s.indexOf('|');
      if (pipe === -1) return { model: s, label: s };
      const model = s.slice(0, pipe).trim();
      const label = s.slice(pipe + 1).trim() || model;
      return { model, label };
    }).filter((o) => o.model);
    if (parsed.length) return parsed;
  }
  return [
    { model: 'gpt-4o', label: 'GPT-4o (OpenAI API)' },
    { model: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI API)' },
    { model: 'gpt-4-turbo', label: 'GPT-4 Turbo (OpenAI API)' },
  ];
}

function toOption(provider, { model, label }) {
  const id = `${provider}/${model}`;
  return { id, provider, model, label };
}

const OLLAMA_OPTS = loadOllamaOptions().map((o) => toOption('ollama', o));
const OPENAI_OPTS = loadOpenAiOptions().map((o) => toOption('openai', o));
const ALL_OPTIONS = [...OLLAMA_OPTS, ...OPENAI_OPTS];
const ALL_BY_ID = new Map(ALL_OPTIONS.map((o) => [o.id, o]));

function pickInitialOptionId() {
  const env = process.env.CHAT_MODEL?.trim();
  if (env && ALL_BY_ID.has(env)) return env;
  if (env && !env.includes('/')) {
    const ollamaHit = OLLAMA_OPTS.find((o) => o.model === env);
    if (ollamaHit) return ollamaHit.id;
  }
  return OLLAMA_OPTS[0]?.id || ALL_OPTIONS[0].id;
}

let currentOptionId = pickInitialOptionId();
let openaiApiKey = (process.env.OPENAI_API_KEY || '').trim();

export function getEmbedClient() {
  return embedClient;
}

export function getChatOptions() {
  return ALL_OPTIONS;
}

function getCurrentOption() {
  return ALL_BY_ID.get(currentOptionId) || ALL_OPTIONS[0];
}

export function getChatProvider() {
  return getCurrentOption().provider;
}

/** OpenAI / Ollama API에 넘기는 모델 이름 */
export function getChatModel() {
  return getCurrentOption().model;
}

export function getChatOptionId() {
  return currentOptionId;
}

export function getChatModelLabel(optionId = currentOptionId) {
  return ALL_BY_ID.get(optionId)?.label || getCurrentOption().label;
}

export function setChatModel(optionId) {
  const id = String(optionId || '').trim();
  if (!id || !ALL_BY_ID.has(id)) {
    throw new Error(`지원하지 않는 모델입니다.`);
  }
  currentOptionId = id;
  return currentOptionId;
}

export function setOpenaiApiKey(key) {
  const k = key === undefined || key === null ? '' : String(key).trim();
  openaiApiKey = k;
  return Boolean(openaiApiKey);
}

export function hasOpenaiApiKey() {
  return Boolean(openaiApiKey);
}

export function getOpenaiKeyHint() {
  if (!openaiApiKey) return null;
  const tail = openaiApiKey.slice(-4);
  return `…${tail}`;
}

export function getChatClient() {
  const opt = getCurrentOption();
  if (opt.provider === 'openai') {
    if (!openaiApiKey) {
      throw new Error('OpenAI API 키를 대시보드에서 저장해 주세요.');
    }
    return new OpenAI({ apiKey: openaiApiKey });
  }
  return ollamaChatClient;
}

export function getLlmSettingsSnapshot() {
  const opt = getCurrentOption();
  return {
    optionId: currentOptionId,
    provider: opt.provider,
    apiModel: opt.model,
    label: opt.label,
  };
}

export async function checkLLMHealth() {
  const startedAt = Date.now();
  const opt = getCurrentOption();
  const model = opt.model;

  try {
    if (opt.provider === 'openai') {
      if (!openaiApiKey) {
        return {
          ok: false,
          state: 'down',
          latencyMs: Date.now() - startedAt,
          model,
          provider: 'openai',
          error: 'OpenAI API 키가 없습니다.',
        };
      }
      const c = new OpenAI({ apiKey: openaiApiKey });
      await c.models.list();
      const latencyMs = Date.now() - startedAt;
      return {
        ok: true,
        state: latencyMs > 2000 ? 'degraded' : 'connected',
        latencyMs,
        model,
        provider: 'openai',
      };
    }

    await ollamaChatClient.models.list();
    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      state: latencyMs > 1200 ? 'degraded' : 'connected',
      latencyMs,
      model,
      provider: 'ollama',
    };
  } catch (err) {
    return {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - startedAt,
      model,
      provider: opt.provider,
      error: err instanceof Error ? err.message : 'LLM health check failed',
    };
  }
}
