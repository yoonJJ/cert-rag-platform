import { useEffect, useMemo, useState } from 'react';
import { PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

const apiBase = import.meta.env.VITE_API_URL || '';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesErr, setFilesErr] = useState('');

  const fileMeta = useMemo(() => {
    if (!file) return '';
    const kb = Math.max(1, Math.round(file.size / 1024));
    return `${file.name} · ${kb}KB`;
  }, [file]);

  function onPickFile(e) {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    setStatus({ type: '', message: '' });
  }

  async function loadUploadedFiles() {
    setLoadingFiles(true);
    setFilesErr('');
    try {
      const res = await fetch(`${apiBase}/api/sources/stats`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '파일 목록 조회 실패');
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setFilesErr(err.message || '파일 목록을 불러오지 못했습니다.');
    } finally {
      setLoadingFiles(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!file || !file.size) {
      setStatus({ type: 'error', message: '업로드할 PDF를 먼저 선택해 주세요.' });
      return;
    }

    setBusy(true);
    setStatus({ type: 'loading', message: '업로드 및 임베딩 진행 중입니다. 잠시만 기다려 주세요…' });

    try {
      const form = new FormData();
      form.append('pdf', file);
      // multipart filename 인코딩이 깨질 수 있어, 브라우저에서 받은 file.name을 별도 필드로 전달합니다.
      form.append('sourceName', file.name);
      const res = await fetch(`${apiBase}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실패');
      setStatus({
        type: 'success',
        message: `업로드 완료: ${data.source} (청크 ${data.chunkCount}개 저장)`,
      });
      await loadUploadedFiles();
    } catch (err) {
      setStatus({ type: 'error', message: err.message || '업로드 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadUploadedFiles();
  }, []);

  return (
    <PageContainer>
      <PageHeader title="PDF 업로드" description="파일 선택 후 한 번에 임베딩까지 처리합니다." />

      <PageCard className="mt-8 p-5 sm:p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <label
            htmlFor="pdf"
            className="block cursor-pointer rounded-xl border border-dashed border-slate-600 bg-slate-950/40 p-5 transition hover:border-slate-400 hover:bg-slate-900/70"
          >
            <p className="text-sm font-semibold text-white">PDF 파일 선택</p>
            <p className="mt-1 text-xs text-slate-400">클릭해서 파일을 선택하세요. (최대 20MB)</p>
            <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
              {fileMeta || '선택된 파일 없음'}
            </p>
          </label>
          <input id="pdf" name="pdf" type="file" accept="application/pdf" onChange={onPickFile} className="sr-only" />

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '업로드 처리 중…' : '업로드 시작'}
          </button>

          <p className="text-xs text-slate-500">업로드 후 자동으로 텍스트 추출 및 벡터 저장이 진행됩니다.</p>
        </form>
      </PageCard>

      {status.message ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            status.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : status.type === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              : 'border-slate-700 bg-slate-900/70 text-slate-300'
          }`}
        >
          {status.message}
        </p>
      ) : null}

      <PageCard className="mt-6 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">업로드된 PDF 목록</h2>
            <p className="mt-1 text-xs text-slate-400">현재 서버에 적재된 파일을 확인할 수 있습니다.</p>
          </div>
          <button
            type="button"
            onClick={loadUploadedFiles}
            disabled={loadingFiles}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
          >
            {loadingFiles ? '불러오는 중…' : '새로고침'}
          </button>
        </div>

        {filesErr ? <p className="mt-3 text-sm text-rose-400">{filesErr}</p> : null}
        {!filesErr && files.length === 0 ? <p className="mt-3 text-sm text-slate-500">아직 업로드된 파일이 없습니다.</p> : null}

        {files.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {files.map((f) => (
              <li key={f.source} className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{f.source}</p>
                    <p className="mt-1 text-xs text-slate-400">청크 {f.chunkCount}개 · 최대 p.{f.maxPage || '-'} · {f.examType}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </PageCard>
    </PageContainer>
  );
}
