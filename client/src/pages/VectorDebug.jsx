import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';
import { PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

export default function VectorDebug() {
  const [source, setSource] = useState('');
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      try {
        const data = await apiJson('/api/sources');
        if (!mounted) return;
        setSources(Array.isArray(data.sources) ? data.sources : []);
      } catch {
        if (mounted) setSources([]);
      }
    }
    loadSources();
    return () => {
      mounted = false;
    };
  }, []);

  async function loadDetails(nextSource, nextOffset = 0) {
    if (!nextSource) {
      setMeta(null);
      setChunks([]);
      setTotal(0);
      setOffset(0);
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const [metaData, chunkData] = await Promise.all([
        apiJson(`/api/sources/metadata?${new URLSearchParams({ source: nextSource, limit: '5' }).toString()}`),
        apiJson(
          `/api/sources/chunks?${new URLSearchParams({
            source: nextSource,
            limit: String(limit),
            offset: String(nextOffset),
          }).toString()}`,
        ),
      ]);
      setMeta(metaData);
      setChunks(Array.isArray(chunkData.chunks) ? chunkData.chunks : []);
      setTotal(Number(chunkData.total || 0));
      setOffset(nextOffset);
    } catch (error) {
      setErr(error.message || '검색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function onChangeSource(e) {
    const next = e.target.value;
    setSource(next);
    loadDetails(next, 0);
  }

  return (
    <PageContainer>
      <PageHeader title="청크/메타데이터 뷰어" description="파일을 선택하면 청크와 메타데이터를 바로 확인할 수 있습니다." />

      <PageCard className="p-5">
        <div className="grid gap-3 md:grid-cols-12">
          <select
            value={source}
            onChange={onChangeSource}
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm md:col-span-8"
          >
            <option value="">파일 선택</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadDetails(source, offset)}
            disabled={loading}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 md:col-span-4"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
        {err ? <p className="mt-3 text-sm text-rose-400">{err}</p> : null}
      </PageCard>

      {meta ? (
        <PageCard className="mt-4 p-5">
          <h2 className="text-sm font-semibold text-white">메타데이터</h2>
          <p className="mt-2 text-sm text-slate-300">
            총 청크 {meta.chunkCount}개 · 페이지 p.{meta.minPage || '-'} ~ p.{meta.maxPage || '-'}
          </p>
          {(meta.sampleChunks || []).length > 0 ? (
            <ul className="mt-3 space-y-2">
              {meta.sampleChunks.map((c) => (
                <li key={c.id} className="rounded-md border border-slate-700/80 bg-slate-950/60 px-3 py-2">
                  <p className="text-[11px] text-slate-500">p.{c.page}</p>
                  <p className="mt-1 text-xs text-slate-300">{c.preview || '(내용 없음)'}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </PageCard>
      ) : null}

      <PageCard className="mt-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">청크 목록</h2>
          <span className="text-xs text-slate-500">
            {source ? `${Math.min(offset + 1, total)}-${Math.min(offset + chunks.length, total)} / ${total}` : '-'}
          </span>
        </div>
        {!source ? <p className="mt-3 text-sm text-slate-500">먼저 파일을 선택하세요.</p> : null}
        {source && chunks.length === 0 && !loading ? <p className="mt-3 text-sm text-slate-500">청크가 없습니다.</p> : null}
        {chunks.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {chunks.map((r, idx) => (
              <li key={r.id || idx} className="rounded-lg border border-slate-700/80 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span>#{offset + idx + 1}</span>
                  <span>p.{r.page ?? '-'}</span>
                </div>
                <p className="mt-2 text-sm text-slate-200">{r.preview}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {source ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={loading || offset === 0}
              onClick={() => loadDetails(source, Math.max(0, offset - limit))}
              className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              disabled={loading || offset + limit >= total}
              onClick={() => loadDetails(source, offset + limit)}
              className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </PageCard>
    </PageContainer>
  );
}
