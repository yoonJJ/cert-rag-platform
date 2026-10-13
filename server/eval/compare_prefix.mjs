import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../db.js';
import { recallAtK, precisionAtK, ndcgAtK, hitAtK, mrr, relevanceFlags, mean } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K = [3,5,10];
const OLLAMA = 'http://localhost:11434/api/embeddings';

async function embed(text) {
  const r = await fetch(OLLAMA, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model:'nomic-embed-text', prompt: text }) });
  const j = await r.json();
  return j.embedding;
}
function cos(a,b){let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return d/(Math.sqrt(x)*Math.sqrt(y));}

const goldset = JSON.parse(fs.readFileSync(path.join(__dirname,'goldset.json'),'utf8'));
const chunks = await prisma.$queryRawUnsafe('SELECT page, content FROM "Chunk" ORDER BY page');
console.log(`청크 ${chunks.length}개, 질의 ${goldset.length}개 로드`);

async function embedDocs(prefix){ const out=[]; for(const c of chunks){ out.push({page:c.page, v: await embed(prefix+c.content)});} return out; }
async function run(label, docPrefix, qPrefix){
  const docs = await embedDocs(docPrefix);
  const rows=[];
  for(const item of goldset){
    const qv = await embed(qPrefix+item.query);
    const ranked = docs.map(d=>({page:d.page, s:cos(qv,d.v)})).sort((a,b)=>b.s-a.s);
    const retrieved = ranked.slice(0,10).map(r=>({page:r.page}));
    const flags = relevanceFlags(retrieved, item.relevantPages);
    const row={};
    for(const k of K){ row[`R@${k}`]=recallAtK(retrieved,item.relevantPages,k); row[`nDCG@${k}`]=ndcgAtK(flags,k); row[`Hit@${k}`]=hitAtK(flags,k);}
    row.MRR=mrr(flags); rows.push(row);
  }
  const keys=Object.keys(rows[0]); const sum={}; for(const k of keys) sum[k]=Number(mean(rows.map(r=>r[k])).toFixed(4));
  console.log(`\n=== ${label} ===`); console.table(sum);
  return {label, summary:sum};
}

const results=[];
results.push(await run('A. 프리픽스 없음 (현재 파이프라인)', '', ''));
results.push(await run('B. nomic 권장 프리픽스', 'search_document: ', 'search_query: '));
fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'results','prefix_compare.json'), JSON.stringify(results,null,2));
console.log('\n저장: eval/results/prefix_compare.json');
await prisma.$disconnect(); process.exit(0);
