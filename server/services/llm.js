import OpenAI from 'openai';

export const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'ollama',
});

export const CHAT_MODEL = 'gpt-oss:20b';
export const EMBED_MODEL = 'nomic-embed-text';

export async function checkLLMHealth() {
  const startedAt = Date.now();
  try {
    await client.models.list();
    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      state: latencyMs > 1200 ? 'degraded' : 'connected',
      latencyMs,
      model: CHAT_MODEL,
    };
  } catch (err) {
    return {
      ok: false,
      state: 'down',
      latencyMs: Date.now() - startedAt,
      model: CHAT_MODEL,
      error: err instanceof Error ? err.message : 'LLM health check failed',
    };
  }
}
