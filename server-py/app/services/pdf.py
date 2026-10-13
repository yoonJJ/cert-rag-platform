"""PyMuPDF 로 PDF 텍스트 추출과 페이지 이미지 렌더링을 처리합니다.
(Node 버전의 pdf-parse + pdfjs-dist + @napi-rs/canvas 조합을 대체)"""

import os

import pymupdf


def extract_pages(data: bytes) -> list[str]:
    """페이지별 텍스트 목록 (인덱스 0 = 1페이지)."""
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return [page.get_text() for page in doc]


def render_pdf_pages(data: bytes, max_pages: int | None = None, scale: float = 2.0) -> dict:
    """PDF 의 각 페이지를 PNG 로 렌더링해 반환합니다(상한 max_pages 까지).
    도표/다이어그램/표는 물론 스캔본(텍스트 추출이 안 되는 PDF)도 이미지로 확보됩니다.
    신뢰성 있게 "도표 페이지"만 자동 선별하기는 어려워(거의 모든 페이지에 로고/아이콘이
    박혀 있음), 상한 안에서 페이지를 렌더링하고 캡셔닝 여부는 호출 측에서 결정합니다."""
    if max_pages is None:
        max_pages = int(os.getenv("PDF_IMAGE_MAX") or 20)
    max_pages = max(1, max_pages)

    pages = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        total_pages = doc.page_count
        limit = min(total_pages, max_pages)
        matrix = pymupdf.Matrix(scale, scale)
        for i in range(limit):
            # alpha=False → 투명 배경이 검게 나오지 않도록 흰 배경으로 렌더링합니다.
            pix = doc[i].get_pixmap(matrix=matrix, alpha=False)
            pages.append({"pageNumber": i + 1, "png": pix.tobytes("png")})

    return {"pages": pages, "totalPages": total_pages, "rendered": len(pages), "truncated": total_pages > limit}
