import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || '';

const LlmStatusContext = createContext(null);

export function LlmStatusProvider({ children }) {
  const [model, setModel] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('ollama');
  const [options, setOptions] = useState([]);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [openaiKeyHint, setOpenaiKeyHint] = useState(null);
  const [llmOk, setLlmOk] = useState(false);
  const [llmState, setLlmState] = useState('down');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/settings/llm`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || 'LLM 설정을 불러오지 못했습니다.');
      }
      setModel(data.model || '');
      setApiModel(data.apiModel || '');
      setLabel(data.label || data.apiModel || '');
      setProvider(data.provider || 'ollama');
      setOptions(Array.isArray(data.options) ? data.options : []);
      setHasOpenAiKey(!!data.hasOpenAiKey);
      setOpenaiKeyHint(data.openaiKeyHint ?? null);
      setLlmOk(!!data.llmOk);
      setLlmState(data.llmState || 'down');
      setError('');
    } catch (e) {
      setLlmOk(false);
      setLlmState('down');
      setError(e instanceof Error ? e.message : 'LLM 설정 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({
      model,
      apiModel,
      label,
      provider,
      options,
      hasOpenAiKey,
      openaiKeyHint,
      llmOk,
      llmState,
      loading,
      error,
      refresh,
    }),
    [
      model,
      apiModel,
      label,
      provider,
      options,
      hasOpenAiKey,
      openaiKeyHint,
      llmOk,
      llmState,
      loading,
      error,
      refresh,
    ],
  );

  return <LlmStatusContext.Provider value={value}>{children}</LlmStatusContext.Provider>;
}

export function useLlmStatus() {
  const ctx = useContext(LlmStatusContext);
  if (!ctx) {
    throw new Error('useLlmStatus는 LlmStatusProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}
