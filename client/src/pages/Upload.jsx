import { useEffect, useMemo, useState } from 'react';
import { PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

const apiBase = import.meta.env.VITE_API_URL || '';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [captionPdfImages, setCaptionPdfImages] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesErr, setFilesErr] = useState('');

  const [image, setImage] = useState(null);
  const [hint, setHint] = useState('');
  const [imgStatus, setImgStatus] = useState({ type: '', message: '' });
  const [imgBusy, setImgBusy] = useState(false);

  const fileMeta = useMemo(() => {
    if (!file) return '';
    const kb = Math.max(1, Math.round(file.size / 1024));
    return `${file.name} · ${kb}KB`;
  }, [file]);

  const imageMeta = useMemo(() => {
    if (!image) return '';
    const kb = Math.max(1, Math.round(image.size / 1024));
    return `${image.name} · ${kb}KB`;
  }, [image]);

  function onPickFile(e) {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    setStatus({ type: '', message: '' });
  }

  function onPickImage(e) {
    const picked = e.target.files?.[0] || null;
    setImage(picked);
    setImgStatus({ type: '', message: '' });
  }

  async function onSubmitImage(e) {
    e.preventDefault();
    if (!image || !image.size) {
      setImgStatus({ type: 'error', message: '업로드할 이미지를 먼저 선택해 주세요.' });
      return;
    }

    setImgBusy(true);
    setImgStatus({ type: 'loading', message: '이미지 분석(비전 캡셔닝) 및 임베딩 진행 중입니다…' });

    try {
      const form = new FormData();
      form.append('image', image);
      form.append('sourceName', image.name);
      if (hint.trim()) form.append('hint', hint.trim());
      const res = await fetch(`${apiBase}/api/upload-image`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실패');
      setImgStatus({
        type: 'success',
        message: `이미지 처리 완료: ${data.source} (청크 ${data.chunkCount}개 저장)${
          data.captionPreview ? `\n설명 미리보기: ${data.captionPreview}` : ''
        }`,
      });
      await loadUploadedFiles();
    } catch (err) {
      setImgStatus({ type: 'error', message: err.message || '이미지 업로드 중 오류가 발생했습니다.' });
    } finally {
      setImgBusy(false);
    }
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
      if (captionPdfImages) form.append('captionImages', 'true');
      const res = await fetch(`${apiBase}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실패');
      const imgPart =
        data.imagePagesCaptioned > 0
          ? ` · 이미지 ${data.imagePagesCaptioned}p 캡셔닝(청크 ${data.imageChunkCount}개)`
          : '';
      setStatus({
        type: 'success',
        message: `업로드 완료: ${data.source} (텍스트 청크 ${data.chunkCount}개${imgPart})${
          data.imageNote ? `\n${data.imageNote}` : ''
        }`,
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

          <label className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2.5">
            <input
              type="checkbox"
              checked={captionPdfImages}
              onChange={(e) => setCaptionPdfImages(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span className="text-xs text-slate-300">
              PDF 페이지의 도표·다이어그램·스캔 내용도 비전 모델로 분석해 함께 임베딩
              <span className="mt-0.5 block text-slate-500">
                페이지마다 비전 호출이 발생해 시간·비용이 늘어납니다. (페이지 상한 적용)
              </span>
            </span>
          </label>

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
          className={`mt-4 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${
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
        <div className="mb-1">
          <h2 className="text-sm font-semibold text-white">이미지 업로드 (비전 캡셔닝)</h2>
          <p className="mt-1 text-xs text-slate-400">
            표·다이어그램·스크린샷 등 이미지를 비전 모델이 설명 텍스트로 변환해 임베딩합니다. (현재 선택된 채팅 모델 사용)
          </p>
        </div>
        <form onSubmit={onSubmitImage} className="mt-4 space-y-4">
          <label
            htmlFor="image"
            className="block cursor-pointer rounded-xl border border-dashed border-slate-600 bg-slate-950/40 p-5 transition hover:border-slate-400 hover:bg-slate-900/70"
          >
            <p className="text-sm font-semibold text-white">이미지 파일 선택</p>
            <p className="mt-1 text-xs text-slate-400">png · jpg · webp · gif (최대 20MB)</p>
            <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
              {imageMeta || '선택된 이미지 없음'}
            </p>
          </label>
          <input id="image" name="image" type="file" accept="image/*" onChange={onPickImage} className="sr-only" />

          <input
            type="text"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="(선택) 이미지 맥락 힌트 — 예: AWS VPC 구성도, SQL 실행계획 표"
            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none"
          />

          <button
            type="submit"
            disabled={imgBusy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {imgBusy ? '이미지 분석 중…' : '이미지 업로드'}
          </button>
        </form>

        {imgStatus.message ? (
          <p
            className={`mt-4 whitespace-pre-line rounded-lg border px-3 py-2 text-sm ${
              imgStatus.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : imgStatus.type === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-slate-700 bg-slate-900/70 text-slate-300'
            }`}
          >
            {imgStatus.message}
          </p>
        ) : null}
      </PageCard>

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
