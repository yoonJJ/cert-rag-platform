import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiJson } from '../lib/api.js';
import { EmptyState, PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';
import MathText from '../components/MathText.jsx';

const LIMIT = 20;

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function ChunkItem({ chunk, query }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/50 transition hover:border-slate-600">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="mt-0.5 w-9 shrink-0 font-mono text-[11px] text-slate-500">#{chunk.index}</span>
        <span className="min-w-0 flex-1">
          {open ? (
            <MathText className="block whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">
              {chunk.content}
            </MathText>
          ) : (
            <span className="line-clamp-2 break-words text-sm leading-relaxed text-slate-300">
              <Highlight text={chunk.preview} query={query} />
            </span>
          )}
        </span>
        <span className="mt-0.5 shrink-0 text-[11px] text-slate-500">{chunk.length.toLocaleString()}자</span>
      </button>
    </li>
  );
}

function Highlight({ text, query }) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts = [];
  let from = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, from)) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(
      <mark key={i} className="rounded bg-amber-400/25 px-0.5 text-amber-100">
        {text.slice(i, i + q.length)}
      </mark>,
    );
    from = i + q.length;
  }
  parts.push(text.slice(from));
  return parts;
}

// 이미 page 순으로 정렬된 청크를 연속된 페이지끼리 묶습니다.
function groupByPage(chunks) {
  const groups = [];
  for (const c of chunks) {
    const last = groups[groups.length - 1];
    if (last && last.page === c.page) last.chunks.push(c);
    else groups.push({ page: c.page, chunks: [c] });
  }
  return groups;
}

export default function VectorDebug() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source') || '';
  const [sources, setSources] = useState([]);
  const [doc, setDoc] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let mounted = true;
    apiJson('/api/sources')
      .then((data) => mounted && setSources(Array.isArray(data.sources) ? data.sources : []))
      .catch(() => mounted && setSources([]));
    return () => {
      mounted = false;
    };
  }, []);

  async function load(nextSource, nextOffset, nextQuery) {
    if (!nextSource) {
      setDoc(null);
      setChunks([]);
      setTotal(0);
      setOffset(0);
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const data = await apiJson(
        `/api/sources/chunks?${new URLSearchParams({
          source: nextSource,
          limit: String(LIMIT),
          offset: String(nextOffset),
          q: nextQuery,
        }).toString()}`,
      );
      setDoc(data.document || null);
      setChunks(Array.isArray(data.chunks) ? data.chunks : []);
      setTotal(Number(data.total || 0));
      setOffset(nextOffset);
    } catch (error) {
      setErr(error.message || '청크를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setQueryInput('');
    setQuery('');
    load(source, 0, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  function onChangeSource(e) {
    const next = e.target.value;
    setParams(next ? { source: next } : {});
  }

  function onSearch(e) {
    e.preventDefault();
    const q = queryInput.trim();
    setQuery(q);
    load(source, 0, q);
  }

  function clearSearch() {
    setQueryInput('');
    setQuery('');
    load(source, 0, '');
  }

  // 레거시 문서는 page 가 청크 순번이라 페이지별로 묶는 의미가 없습니다.
  const legacy = doc?.pageAccurate === false;
  const pageCount = legacy ? null : (doc?.pageCount ?? doc?.maxPage);
  const groups = legacy ? [{ page: null, chunks }] : groupByPage(chunks);
  const avgLength = chunks.length ? Math.round(chunks.reduce((n, c) => n + c.length, 0) / chunks.length) : 0;
  const lastPage = offset + LIMIT >= total;

  return (
    <PageContainer>
      <PageHeader title="청크 뷰어" description="문서가 어떻게 잘려 저장됐는지 페이지별로 확인합니다." />

      <PageCard className="p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <select
            value={source}
            onChange={onChangeSource}
            className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="">문서 선택</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {source ? (
            <form onSubmit={onSearch} className="flex gap-2 md:w-80">
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="청크 내용 검색"
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                검색
              </button>
            </form>
          ) : null}
        </div>

        {doc ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="청크" value={`${(doc.chunkCount ?? total).toLocaleString()}개`} />
            <Stat label="페이지" value={pageCount ? `${pageCount}p` : legacy ? '알 수 없음' : '-'} />
            <Stat label="평균 길이(현재 목록)" value={avgLength ? `${avgLength}자` : '-'} />
            <Stat label="이미지 캡션" value={doc.imageCaptioned ? '포함' : '없음'} />
          </div>
        ) : null}
        {legacy ? (
          <p className="mt-3 text-xs text-amber-300/90">
            예전 방식으로 저장된 문서라 번호가 실제 페이지가 아니라 청크 순번입니다. 문서 메뉴에서 다시 올리면 실제
            페이지로 바뀝니다.
          </p>
        ) : null}
        {err ? <p className="mt-3 text-sm text-rose-400">{err}</p> : null}
      </PageCard>

      {source ? (
        <PageCard className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">
              {query ? (
                <>
                  “{query}” 검색 결과 <span className="font-normal text-slate-400">{total}개</span>
                  <button type="button" onClick={clearSearch} className="ml-2 text-xs font-normal text-accent">
                    지우기
                  </button>
                </>
              ) : (
                '청크 목록'
              )}
            </h2>
            <span className="text-xs text-slate-500">
              {total ? `${offset + 1}–${Math.min(offset + chunks.length, total)} / ${total}` : ''}
              {loading ? ' · 불러오는 중…' : ''}
            </span>
          </div>

          {!loading && chunks.length === 0 ? (
            <EmptyState className="mt-4" text={query ? '일치하는 청크가 없습니다.' : '청크가 없습니다.'} />
          ) : null}

          <div className={`mt-4 space-y-5 ${loading ? 'opacity-60' : ''}`}>
            {groups.map((g) => (
              <section key={`${g.page}-${g.chunks[0]?.id}`}>
                {legacy ? null : (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-200">
                      p.{g.page ?? '-'}
                    </span>
                    <span className="text-[11px] text-slate-500">청크 {g.chunks.length}개</span>
                    <span className="h-px flex-1 bg-slate-800" />
                  </div>
                )}
                <ul className="space-y-1.5">
                  {g.chunks.map((c) => (
                    <ChunkItem key={c.id} chunk={c} query={query} />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {total > LIMIT ? (
            <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
              <button
                type="button"
                disabled={loading || offset === 0}
                onClick={() => load(source, Math.max(0, offset - LIMIT), query)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="text-xs text-slate-500">
                {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
              </span>
              <button
                type="button"
                disabled={loading || lastPage}
                onClick={() => load(source, offset + LIMIT, query)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          ) : null}
        </PageCard>
      ) : (
        <PageCard className="mt-4 p-5">
          <EmptyState text="위에서 문서를 선택하세요." />
        </PageCard>
      )}
    </PageContainer>
  );
}
