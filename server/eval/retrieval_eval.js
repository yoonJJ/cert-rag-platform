// RAG 검색 품질 평가 러너
//
// 골드셋(goldset.json)의 질의들을 실제 검색 파이프라인(retrieveChunks)에 넣고
// Recall@k · Precision@k · nDCG@k · Hit@k · MRR 을 계산해 표로 출력하고
// eval/results/ 에 JSON·CSV 로 저장한다.
//
// 실행: server 디렉터리에서  `node eval/retrieval_eval.js`
//   - 필요한 환경변수: DATABASE_URL, OPENAI_API_KEY (임베딩용), EMBED_MODEL/EMBED_DIMENSIONS
//   - 사전 조건: 평가 대상 PDF가 업로드되어 Chunk 테이블에 임베딩이 적재되어 있어야 함
//   - 비교 실험 태그: RUN_TAG=chunk650 node eval/retrieval_eval.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { retrieveChunks } from '../services/rag.js';
import { prisma } from '../db.js';
import {
  relevanceFlags,
  hitAtK,
  precisionAtK,
  recallAtK,
  mrr,
  ndcgAtK,
  mean,
} from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K_VALUES = [3, 5, 10];
const MAX_K = Math.max(...K_VALUES);

function loadGoldset() {
  const p = path.join(__dirname, 'goldset.json');
  if (!fs.existsSync(p)) {
    console.error('[오류] eval/goldset.json 이 없습니다. eval/goldset.example.json 을 복사해 채워주세요.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!Array.isArray(data) || data.length === 0) {
    console.error('[오류] goldset.json 이 비어 있습니다.');
    process.exit(1);
  }
  return data;
}

async function main() {
  const goldset = loadGoldset();
  console.log(`검색 평가 시작: 질의 ${goldset.length}개, k=${K_VALUES.join(', ')}\n`);

  const perQuery = [];
  for (const [i, item] of goldset.entries()) {
    const { query, source = '', relevantPages = [] } = item;
    // 한글 파일명은 macOS(NFD)와 손으로 적은 골드셋(NFC)의 유니코드 정규화가 다를 수 있다.
    // FastAPI 서버는 source 를 NFC 로 통일해 저장하므로 골드셋도 NFC 로 맞춘다.
    const retrieved = await retrieveChunks(query, MAX_K, source.normalize('NFC'));
    const flags = relevanceFlags(retrieved, relevantPages);

    const row = { query, n: relevantPages.length };
    for (const k of K_VALUES) {
      row[`R@${k}`] = recallAtK(retrieved, relevantPages, k);
      row[`P@${k}`] = precisionAtK(flags, k);
      row[`nDCG@${k}`] = ndcgAtK(flags, k);
      row[`Hit@${k}`] = hitAtK(flags, k);
    }
    row.MRR = mrr(flags);
    perQuery.push(row);

    console.log(
      `[${i + 1}/${goldset.length}] ${String(query).slice(0, 40).padEnd(40)} ` +
        `R@5=${row['R@5'].toFixed(2)} nDCG@5=${row['nDCG@5'].toFixed(2)} MRR=${row.MRR.toFixed(2)}`,
    );
  }

  // 집계 (macro 평균 = 질의별 지표의 단순 평균)
  const metricKeys = Object.keys(perQuery[0]).filter((k) => k !== 'query' && k !== 'n');
  const summary = {};
  for (const key of metricKeys) summary[key] = mean(perQuery.map((r) => r[key]));

  console.log('\n=== 집계 (macro 평균) ===');
  console.table(Object.fromEntries(metricKeys.map((k) => [k, Number(summary[k].toFixed(4))])));

  // 결과 저장 (실험 비교용 태그)
  const stamp = process.env.RUN_TAG || 'latest';
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });

  const config = {
    runTag: stamp,
    k: K_VALUES,
    embedModel: process.env.EMBED_MODEL || 'text-embedding-3-small',
    embedDimensions: Number(process.env.EMBED_DIMENSIONS || 768),
    numQueries: goldset.length,
  };
  fs.writeFileSync(
    path.join(outDir, `retrieval_${stamp}.json`),
    JSON.stringify({ config, summary, perQuery }, null, 2),
  );

  const header = ['query', 'n', ...metricKeys].join(',');
  const lines = perQuery.map((r) =>
    [JSON.stringify(r.query), r.n, ...metricKeys.map((k) => r[k].toFixed(4))].join(','),
  );
  fs.writeFileSync(path.join(outDir, `retrieval_${stamp}.csv`), [header, ...lines].join('\n'));

  console.log(`\n결과 저장 완료: eval/results/retrieval_${stamp}.json (+ .csv)`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('[평가 실행 오류]', e);
  try {
    await prisma.$disconnect();
  } catch {
    /* noop */
  }
  process.exit(1);
});
