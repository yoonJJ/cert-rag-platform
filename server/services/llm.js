import OpenAI from 'openai';

// 임베딩은 OpenAI API 키로 수행합니다. DB의 vector(768) 컬럼과 맞추기 위해 768차원으로 요청합니다.
export const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';
export const EMBED_DIMENSIONS = Number(process.env.EMBED_DIMENSIONS || 768);

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

const OPENAI_DEFAULT = [
  { model: 'gpt-5', label: 'GPT-5 (OpenAI API)' },
  { model: 'gpt-5-mini', label: 'GPT-5 mini (OpenAI API)' },
  { model: 'gpt-5-nano', label: 'GPT-5 nano (OpenAI API)' },
  { model: 'gpt-4.1', label: 'GPT-4.1 (OpenAI API)' },
  { model: 'gpt-4.1-mini', label: 'GPT-4.1 mini (OpenAI API)' },
  { model: 'gpt-4o', label: 'GPT-4o (OpenAI API)' },
  { model: 'gpt-4o-mini', label: 'GPT-4o mini (OpenAI API)' },
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
  ...parseOptionList(process.env.OPENAI_CHAT_MODELS, OPENAI_DEFAULT).map((o) => withProvider('openai', o)),
  ...parseOptionList(process.env.GEMINI_CHAT_MODELS, GEMINI_DEFAULT).map((o) => withProvider('gemini', o)),
  ...parseOptionList(process.env.CLAUDE_CHAT_MODELS, CLAUDE_DEFAULT).map((o) => withProvider('claude', o)),
];

const OPTION_BY_ID = new Map(OPTIONS.map((o) => [o.id, o]));

function pickInitialOptionId() {
  const env = String(process.env.CHAT_MODEL || '').trim();
  if (env && OPTION_BY_ID.has(env)) return env;
  return OPTIONS[0]?.id;
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

// GPT-5 / o 시리즈 등 추론(reasoning) 모델 여부. 이 모델들은 추론 토큰이
// 출력 한도(max_completion_tokens)를 잠식해, 한도가 작으면 추론에 다 쓰여
// 응답 content 가 빈 문자열로 돌아옵니다. 출제·캡셔닝·전사는 깊은 추론이
// 필요 없으므로 'minimal' 로 두어 거의 모든 토큰을 출력에 할당합니다.
function isReasoningModel(model) {
  return /^(gpt-5|o\d)/.test(String(model || ''));
}
const REASONING_EFFORT = 'minimal';

export function getEmbedClient() {
  // 임베딩 제공자를 EMBED_BASE_URL 로 바꿔 끼울 수 있습니다(OpenAI 호환 엔드포인트).
  // 예: 로컬 Ollama nomic-embed-text → EMBED_BASE_URL=http://localhost:11434/v1
  const baseURL = String(process.env.EMBED_BASE_URL || '').trim();
  if (baseURL) {
    return new OpenAI({ baseURL, apiKey: String(process.env.EMBED_API_KEY || 'ollama').trim() });
  }
  if (!providerApiKeys.openai) throw new Error('임베딩을 위해 OpenAI API 키를 입력해 주세요.');
  return new OpenAI({ apiKey: providerApiKeys.openai });
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
  const { messages = [], max_tokens, response_format } = params;
  const opt = currentOption();
  const model = opt.model;

  if (opt.provider === 'openai') {
    if (!providerApiKeys.openai) throw new Error('OpenAI API 키를 입력해 주세요.');
    const c = new OpenAI({ apiKey: providerApiKeys.openai });
    // 최신 OpenAI 모델(GPT-5 계열 등)은 max_tokens 대신 max_completion_tokens를 사용합니다.
    // 또한 추론(reasoning) 토큰이 출력 한도를 잠식해 응답이 비는 것을 막기 위해 추론 강도를 낮춥니다.
    const res = await c.chat.completions.create({
      model,
      messages,
      max_completion_tokens: max_tokens,
      ...(isReasoningModel(model) ? { reasoning_effort: REASONING_EFFORT } : {}),
      ...(response_format ? { response_format } : {}),
    });
    const ch = res.choices?.[0];
    if (!ch?.message?.content) {
      console.warn(
        `createChatCompletion 빈 응답 (model=${model}, finish_reason=${ch?.finish_reason}, usage=${JSON.stringify(res.usage)})`,
      );
    }
    return res;
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

  if (opt.provider === 'openai') {
    if (!providerApiKeys.openai) throw new Error('OpenAI API 키를 입력해 주세요.');
    const c = new OpenAI({ apiKey: providerApiKeys.openai });
    // 최신 OpenAI 모델(GPT-5 계열 등)은 max_tokens 대신 max_completion_tokens를 사용합니다.
    return c.chat.completions.create({
      model,
      messages,
      max_completion_tokens: max_tokens,
      ...(isReasoningModel(model) ? { reasoning_effort: REASONING_EFFORT } : {}),
      stream: true,
    });
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

const VISION_PROMPT = `이 이미지는 학습/시험 자료(문제·수식·표 포함)의 한 페이지입니다. 시험 출제에 그대로 쓸 수 있도록 페이지 내용을 한국어로 "빠짐없이 전사"하세요. 요약·설명이 아니라 원문 그대로 옮기는 것이 목적입니다.

규칙:
- 모든 텍스트·문제·보기·수식·표를 생략 없이 전사하세요. "…", "(생략)", "이하 동일" 같은 축약을 절대 쓰지 마세요.
- 수식은 반드시 LaTeX 로 적으세요. 인라인 수식은 $...$ 사이, 독립된 식은 $$...$$ 사이에 넣습니다.
  · 분수는 \\frac{분자}{분모} 형태로 (예: $\\frac{T}{0.61}$, $E_\\gamma = \\frac{hc}{\\lambda}$). 절대 슬래시(a/b)로 쓰지 마세요.
  · 지수·첨자는 ^{} 와 _{} 로 (예: $10^{-19}$, $E_\\gamma$, $\\frac{\\mu_{en}}{\\rho}$)
  · 그리스문자·기호는 \\lambda, \\rho, \\Sigma, \\int 등으로
  · 계산 과정이 있으면 중간 단계와 최종 결과까지 모두 LaTeX 로 적으세요.
- 표/그래프/다이어그램은 항목·수치·관계를 빠짐없이 텍스트(필요하면 표 형식)로 옮기세요.
- 정말 판독이 불가능한 부분만 "[판독 불가]"로 표시하세요.
- 이미지에 없는 내용을 지어내지 마세요.
전사 결과 텍스트만 출력하세요(머리말·맺음말 없이).`;

// 이미지를 현재 선택된 provider의 비전 모델로 분석해 "설명 텍스트"를 만듭니다.
// 반환된 텍스트는 호출 측에서 기존 텍스트 청크와 동일하게 임베딩됩니다.
export async function captionImage(buffer, mimeType = 'image/png', hint = '') {
  const opt = currentOption();
  const b64 = Buffer.from(buffer).toString('base64');
  const promptText = hint ? `${VISION_PROMPT}\n\n[추가 맥락]\n${hint}` : VISION_PROMPT;

  if (opt.provider === 'claude') {
    const key = providerApiKeys.claude;
    if (!key) throw new Error('이미지 분석을 위해 Claude API 키를 입력해 주세요.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opt.model,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
            ],
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.message || '이미지 분석 실패(Claude)');
    return (data.content || []).map((c) => c?.text || '').join('').trim();
  }

  // openai / gemini: OpenAI 호환 chat.completions + image_url(data URL)
  let client;
  if (opt.provider === 'openai') {
    if (!providerApiKeys.openai) throw new Error('이미지 분석을 위해 OpenAI API 키를 입력해 주세요.');
    client = new OpenAI({ apiKey: providerApiKeys.openai });
  } else {
    if (!providerApiKeys.gemini) throw new Error('이미지 분석을 위해 Gemini API 키를 입력해 주세요.');
    client = new OpenAI({
      baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: providerApiKeys.gemini,
    });
  }

  const createParams = {
    model: opt.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
        ],
      },
    ],
  };
  // OpenAI 최신 모델은 max_completion_tokens, Gemini 호환 엔드포인트는 max_tokens 사용.
  if (opt.provider === 'openai') {
    // GPT-5/o 계열은 추론 토큰이 출력 한도를 잠식하므로 한도를 크게 두고 추론 강도를 낮춥니다.
    // (한도가 작으면 추론에 다 쓰여 content 가 빈 문자열로 돌아옵니다.)
    createParams.max_completion_tokens = 8000;
    if (isReasoningModel(opt.model)) createParams.reasoning_effort = REASONING_EFFORT;
  } else {
    createParams.max_tokens = 4000;
  }

  const res = await client.chat.completions.create(createParams);
  const choice = res.choices?.[0];
  const out = (choice?.message?.content || '').trim();
  if (!out) {
    console.warn(`captionImage 빈 응답 (model=${opt.model}, finish_reason=${choice?.finish_reason})`);
  }
  return out;
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
    if (opt.provider === 'openai') {
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
