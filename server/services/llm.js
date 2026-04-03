import OpenAI from 'openai';

export const EMBED_MODEL = 'nomic-embed-text';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || 'ollama';

const embedClient = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: OLLAMA_API_KEY });
const ollamaChatClient = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: OLLAMA_API_KEY });

function parseOptionList(raw, fallback) {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  const parsed = text
    .split(',')
    .map((segment) => {
      const s = segment.trim();
      if (!s) return null;
      const pipe = s.indexOf('|');
      if (pipe === -1) return { model: s, label: s };
      const model = s.slice(0, pipe).trim();
      const label = s.slice(pipe + 1).trim() || model;
      return model ? { model, label } : null;
    })
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

const OLLAMA_DEFAULT = [
  { model: 'gpt-oss:20b', label: 'GPT-OSS 20B (Ollama)' },
  { model: 'gemma4:26b', label: 'Gemma 4 26B (Ollama)' },
];

const OPENAI_DEFAULT = [
  { model: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI API)' },
  { model: 'gpt-4o', label: 'GPT-4o (OpenAI API)' },
  { model: 'gpt-4.1-mini', label: 'GPT-4.1 mini (OpenAI API)' },
];

const GEMINI_DEFAULT = [
  { model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (프리티어) (Gemini API)' },
  { model: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (프리티어) (Gemini API)' },
  { model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Gemini API)' },
];

const CLAUDE_DEFAULT = [
  { model: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (Claude API)' },
  { model: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Claude API)' },
];

function withProvider(provider, o) {
  return { id: `${provider}/${o.model}`, provider, model: o.model, label: o.label };
}

const OPTIONS = [
  ...parseOptionList(process.env.OLLAMA_CHAT_MODELS, OLLAMA_DEFAULT).map((o) => withProvider('ollama', o)),
  ...parseOptionList(process.env.OPENAI_CHAT_MODELS, OPENAI_DEFAULT).map((o) => withProvider('openai', o)),
  ...parseOptionList(process.env.GEMINI_CHAT_MODELS, GEMINI_DEFAULT).map((o) => withProvider('gemini', o)),
  ...parseOptionList(process.env.CLAUDE_CHAT_MODELS, CLAUDE_DEFAULT).map((o) => withProvider('claude', o)),
];

const OPTION_BY_ID = new Map(OPTIONS.map((o) => [o.id, o]));

function pickInitialOptionId() {
  const env = String(process.env.CHAT_MODEL || '').trim();
  if (env && OPTION_BY_ID.has(env)) return env;
  if (env && !env.includes('/')) {
    const hit = OPTIONS.find((o) => o.provider === 'ollama' && o.model === env);
    if (hit) return hit.id;
  }
  return OPTIONS.find((o) => o.provider === 'ollama')?.id || OPTIONS[0]?.id;
}

let currentOptionId = pickInitialOptionId();
const providerApiKeys = {
  openai: String(process.env.OPENAI_API_KEY || '').trim(),
  gemini: String(process.env.GEMINI_API_KEY || '').trim(),
  claude: String(process.env.CLAUDE_API_KEY || '').trim(),
};

function currentOption() {
  return OPTION_BY_ID.get(currentOptionId) || OPTIONS[0];
}

function keyHint(value) {
  if (!value) return null;
  return `…${value.slice(-4)}`;
}

export function getEmbedClient() {
  return embedClient;
}

export function getChatOptions() {
  return OPTIONS;
}

export function getChatProvider() {
  return currentOption().provider;
}

export function getChatModel() {
  return currentOption().model;
}

export function getChatOptionId() {
  return currentOptionId;
}

export function getChatModelLabel(optionId = currentOptionId) {
  return OPTION_BY_ID.get(optionId)?.label || currentOption().label;
}

export function setChatModel(optionId) {
  const id = String(optionId || '').trim();
  if (!OPTION_BY_ID.has(id)) throw new Error('지원하지 않는 모델입니다.');
  currentOptionId = id;
  return currentOptionId;
}

export function setProviderApiKey(provider, key) {
  if (!['openai', 'gemini', 'claude'].includes(provider)) {
    throw new Error('API 키를 저장할 수 없는 provider입니다.');
  }
  providerApiKeys[provider] = String(key ?? '').trim();
  return Boolean(providerApiKeys[provider]);
}

export function hasProviderApiKey(provider) {
  return Boolean(providerApiKeys[provider]);
}

export function getProviderKeyHint(provider) {
  return keyHint(providerApiKeys[provider]);
}

function toAnthropicRequest(messages, maxTokens = 1024) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
    .trim();
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  return { system: system || undefined, messages: converted, max_tokens: maxTokens };
}

async function anthropicCreate({ model, messages, max_tokens = 1024 }) {
  const key = providerApiKeys.claude;
  if (!key) throw new Error('Claude API 키를 입력해 주세요.');
  const body = {
    model,
    ...toAnthropicRequest(messages, max_tokens),
    stream: false,
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.message || 'Claude 요청 실패');
  const text = (data.content || []).map((c) => c?.text || '').join('');
  return { choices: [{ message: { content: text } }] };
}

async function* anthropicStream({ model, messages, max_tokens = 1024 }) {
  const key = providerApiKeys.claude;
  if (!key) throw new Error('Claude API 키를 입력해 주세요.');
  const body = {
    model,
    ...toAnthropicRequest(messages, max_tokens),
    stream: true,
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.message || 'Claude 스트리밍 요청 실패');
  }
  const decoder = new TextDecoder();
  const reader = res.body?.getReader();
  if (!reader) return;
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() || '';
    for (const b of blocks) {
      const line = b.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const text = json?.delta?.text || json?.content_block?.text || '';
        if (text) yield { choices: [{ delta: { content: text } }] };
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export async function createChatCompletion(params) {
  const { messages = [], max_tokens } = params;
  const opt = currentOption();
  const model = opt.model;

  if (opt.provider === 'ollama') {
    return ollamaChatClient.chat.completions.create({ model, messages, max_tokens });
  }
  if (opt.provider === 'openai') {
    if (!providerApiKeys.openai) throw new Error('OpenAI API 키를 입력해 주세요.');
    const c = new OpenAI({ apiKey: providerApiKeys.openai });
    return c.chat.completions.create({ model, messages, max_tokens });
  }
  if (opt.provider === 'gemini') {
    if (!providerApiKeys.gemini) throw new Error('Gemini API 키를 입력해 주세요.');
    const c = new OpenAI({
      baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: providerApiKeys.gemini,
    });
    return c.chat.completions.create({ model, messages, max_tokens });
  }
  return anthropicCreate({ model, messages, max_tokens });
}

export async function createChatCompletionStream(params) {
  const { messages = [], max_tokens } = params;
  const opt = currentOption();
  const model = opt.model;

  if (opt.provider === 'ollama') {
    return ollamaChatClient.chat.completions.create({ model, messages, max_tokens, stream: true });
  }
  if (opt.provider === 'openai') {
    if (!providerApiKeys.openai) throw new Error('OpenAI API 키를 입력해 주세요.');
    const c = new OpenAI({ apiKey: providerApiKeys.openai });
    return c.chat.completions.create({ model, messages, max_tokens, stream: true });
  }
  if (opt.provider === 'gemini') {
    if (!providerApiKeys.gemini) throw new Error('Gemini API 키를 입력해 주세요.');
    const c = new OpenAI({
      baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: providerApiKeys.gemini,
    });
    return c.chat.completions.create({ model, messages, max_tokens, stream: true });
  }
  return anthropicStream({ model, messages, max_tokens });
}

export function getLlmSettingsSnapshot() {
  const opt = currentOption();
  return {
    optionId: currentOptionId,
    provider: opt.provider,
    apiModel: opt.model,
    label: opt.label,
    keyStatus: {
      openai: hasProviderApiKey('openai'),
      gemini: hasProviderApiKey('gemini'),
      claude: hasProviderApiKey('claude'),
    },
    keyHints: {
      openai: getProviderKeyHint('openai'),
      gemini: getProviderKeyHint('gemini'),
      claude: getProviderKeyHint('claude'),
    },
  };
}

export async function checkLLMHealth() {
  const startedAt = Date.now();
  const opt = currentOption();
  try {
    if (opt.provider === 'ollama') {
      await ollamaChatClient.models.list();
    } else if (opt.provider === 'openai') {
      if (!providerApiKeys.openai) throw new Error('OpenAI API 키가 없습니다.');
      const c = new OpenAI({ apiKey: providerApiKeys.openai });
      await c.models.list();
    } else if (opt.provider === 'gemini') {
      if (!providerApiKeys.gemini) throw new Error('Gemini API 키가 없습니다.');
      const c = new OpenAI({
        baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: providerApiKeys.gemini,
      });
      await c.models.list();
    } else {
      if (!providerApiKeys.claude) throw new Error('Claude API 키가 없습니다.');
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': providerApiKeys.claude,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!r.ok) throw new Error('Claude API 연결 실패');
    }

    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      state: latencyMs > 1800 ? 'degraded' : 'connected',
      latencyMs,
      model: opt.model,
      provider: opt.provider,
    };
  } catch (err) {
    return {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - startedAt,
      model: opt.model,
      provider: opt.provider,
      error: err instanceof Error ? err.message : 'LLM health check failed',
    };
  }
}
