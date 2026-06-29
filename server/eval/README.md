# RAG 평가 레이어 (Evaluation)

이 디렉터리는 cert-rag-platform 의 **검색·생성 품질을 정량적으로 측정**하기 위한 평가 코드다.
"RAG 시스템을 만들었다"에서 나아가 **"측정했고, 비교했고, 무엇이 더 나은지 발견했다"**를 목표로 한다.

## 무엇을 측정하나

| 대상 | 방법 | 현재 구현 |
|---|---|---|
| 검색(Retrieval) | 표준 IR 지표(Recall@k·Precision@k·nDCG@k·Hit@k·MRR) | 1주차 (구현됨) |
| 생성(Generation) | LLM-as-a-Judge 루브릭(근거성·정답정확성·답변가능성·오답매력도·난이도) | 2주차 예정 |
| 판정자 신뢰성 | 사람 vs LLM-Judge 일치도(Cohen's κ) | 2주차 예정 |

## 1주차: 검색 품질 측정

### 관련도 정의
청크 단위 수동 라벨링은 비용이 크므로, **정답 근거가 있는 PDF 페이지**를 기준으로 삼는다.
검색된 청크의 `page` 가 골드셋의 `relevantPages` 에 포함되면 관련(relevant)으로 본다.

### 골드셋 작성
`goldset.example.json` 을 참고해 `goldset.json` 을 채운다.

```json
[
  { "query": "트랜잭션의 ACID 특성을 묻는 문제", "source": "SQLD_요약.pdf", "relevantPages": [12, 13] }
]
```

- `query`: 검색에 넣을 자연어 질의(출제 토픽과 동일한 형태)
- `source`: 업로드 시 저장된 PDF 파일명 — DB `Chunk.source` 값과 정확히 일치해야 함
  (확인: `SELECT DISTINCT source FROM "Chunk";`)
- `relevantPages`: 그 질의의 정답 근거가 실린 PDF 페이지 번호들

질의 30~50개를 권장한다. 1차로 검색 결과를 보고 페이지를 라벨링하면 빠르다.

### 실행

```bash
cd server
node eval/retrieval_eval.js
# 비교 실험 시 태그를 붙여 결과를 구분 저장:
RUN_TAG=topk5_chunk650 node eval/retrieval_eval.js
```

결과는 콘솔 표 + `eval/results/retrieval_<tag>.json` / `.csv` 로 저장된다.

### 지표 의미
- **Recall@k**: 관련 페이지 중 top-k 안에서 찾은 비율 (놓치지 않았나)
- **Precision@k**: top-k 중 관련 비율 (잡음이 적은가)
- **nDCG@k**: 관련 청크를 위로 올렸는가 (순위 품질)
- **Hit@k**: top-k에 관련 청크가 하나라도 있나
- **MRR**: 첫 관련 청크의 평균 역순위

## 비교 실험 (RQ3)
청크 크기·top-k·임베딩 모델 등을 바꿔가며 `RUN_TAG` 를 달리 주고 실행한 뒤
`results/` 의 지표를 비교해 트레이드오프를 정리한다.

> 전체 설계: 저장소 외부 문서 `평가레이어_설계.md` 참고.
