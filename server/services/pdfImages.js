import * as nc from '@napi-rs/canvas';
import { createRequire } from 'module';
import path from 'path';

const { createCanvas } = nc;

// pdfjs 가 Node 에서 렌더링하려면 브라우저 전역 클래스가 필요합니다.
// @napi-rs/canvas 가 제공하는 구현으로 폴리필해야 clip/fill(Path2D)·DOMMatrix 가 동작합니다.
// (pdfjs 는 아래 lazy import 시점에 이 전역들을 사용합니다.)
if (!globalThis.DOMMatrix && nc.DOMMatrix) globalThis.DOMMatrix = nc.DOMMatrix;
if (!globalThis.Path2D && nc.Path2D) globalThis.Path2D = nc.Path2D;
if (!globalThis.ImageData && nc.ImageData) globalThis.ImageData = nc.ImageData;

const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
const CMAP_URL = `${path.join(PDFJS_DIR, 'cmaps')}/`;
const STANDARD_FONTS_URL = `${path.join(PDFJS_DIR, 'standard_fonts')}/`;

// Node 환경에서 pdfjs 가 페이지를 렌더링하려면 DOM 대신 쓸 CanvasFactory 가 필요합니다.
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
  }

  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

let pdfjsPromise;
async function getPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * PDF 버퍼의 각 페이지를 PNG 로 렌더링해 반환합니다(상한 maxPages 까지).
 * 도표/다이어그램/표는 물론 스캔본(텍스트 추출이 안 되는 PDF)도 이미지로 확보됩니다.
 * 신뢰성 있게 "도표 페이지"만 자동 선별하기는 어려워(거의 모든 페이지에 로고/아이콘이
 * 박혀 있음), 상한 안에서 페이지를 렌더링하고 캡셔닝 여부는 호출 측에서 결정합니다.
 * @returns {Promise<{pages:{pageNumber:number, png:Buffer}[], totalPages:number, rendered:number, truncated:boolean}>}
 */
export async function renderPdfPages(buffer, opts = {}) {
  const maxPages = Math.max(1, Number(opts.maxPages ?? process.env.PDF_IMAGE_MAX ?? 20));
  const scale = Number(opts.scale ?? 2.0);

  const { getDocument } = await getPdfjs();
  const canvasFactory = new NodeCanvasFactory();

  const doc = await getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    canvasFactory,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONTS_URL,
  }).promise;

  const totalPages = doc.numPages;
  const limit = Math.min(totalPages, maxPages);
  const pages = [];
  try {
    for (let p = 1; p <= limit; p += 1) {
      const page = await doc.getPage(p);
      try {
        const viewport = page.getViewport({ scale });
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
        // 투명 배경이 검게 나오지 않도록 흰 배경을 깔아줍니다.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
        pages.push({ pageNumber: p, png: canvas.toBuffer('image/png') });
        canvasFactory.destroy({ canvas, context });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return { pages, totalPages, rendered: pages.length, truncated: totalPages > limit };
}
