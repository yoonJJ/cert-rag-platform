// RAG 검색 품질 평가 지표
//
// 관련도(relevance) 정의: 검색된 청크의 page 번호가 골드셋의 relevantPages 에
// 포함되면 "관련 있음(1)", 아니면 "관련 없음(0)" 으로 본다 (페이지 단위 관련도).
// 청크 단위 라벨링은 비용이 크므로, 정답 근거가 있는 PDF 페이지를 기준으로 삼는
// 실용적 프록시다. 모든 지표는 이 0/1 관련도 플래그 위에서 계산된다.

/** 검색 결과(retrieved)를 골드 페이지 집합과 대조해 0/1 관련도 배열로 변환 */
export function relevanceFlags(retrieved, relevantPages) {
  const rel = new Set(relevantPages);
  return retrieved.map((r) => (rel.has(r.page) ? 1 : 0));
}

/** Hit@k: top-k 안에 관련 청크가 하나라도 있으면 1 */
export function hitAtK(flags, k) {
  return flags.slice(0, k).some((f) => f === 1) ? 1 : 0;
}

/** Precision@k: top-k 중 관련 청크의 비율 */
export function precisionAtK(flags, k) {
  const top = flags.slice(0, k);
  if (top.length === 0) return 0;
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/**
 * Recall@k: 전체 관련 페이지 중 top-k 안에서 발견된 비율.
 * 같은 페이지의 청크가 여러 개 잡혀도 한 번만 센다(페이지 단위 회수율).
 */
export function recallAtK(retrieved, relevantPages, k) {
  const rel = new Set(relevantPages);
  if (rel.size === 0) return 0;
  const hitPages = new Set(
    retrieved
      .slice(0, k)
      .map((r) => r.page)
      .filter((p) => rel.has(p)),
  );
  return hitPages.size / rel.size;
}

/** MRR: 첫 관련 청크의 역순위(1/rank). 없으면 0 */
export function mrr(flags) {
  const idx = flags.findIndex((f) => f === 1);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/** DCG@k: 순위 가중 누적 이득 (rel_i / log2(i+2)) */
export function dcgAtK(flags, k) {
  return flags.slice(0, k).reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
}

/** nDCG@k: DCG 를 이상적 정렬(IDCG)로 정규화한 순위 품질 지표 */
export function ndcgAtK(flags, k) {
  const dcg = dcgAtK(flags, k);
  const ideal = [...flags].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** 산술 평균 */
export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
