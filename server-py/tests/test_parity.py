"""Node 서버의 순수 함수와 결과가 같은지 비교합니다. (node 가 없으면 건너뜀)"""

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.chunker import chunk_text
from app.utils import normalize_answer_index

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node 가 필요합니다")


def run_node(script: str, payload) -> object:
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        cwd=SERVER_DIR,
        check=True,
    )
    return json.loads(out.stdout)


def sample_texts() -> list[str]:
    rng = random.Random(42)
    words = ["데이터베이스", "정규화는", "중복을", "줄인다.", "TCP", "3-way", "handshake", "SELECT", "\n", "\t", "  "]
    texts = ["", "   ", "짧은 문장.", "a" * 2000]
    for _ in range(30):
        n = rng.randint(50, 900)
        texts.append(" ".join(rng.choice(words) for _ in range(n)))
    return texts


def test_chunk_text_matches_node():
    texts = sample_texts()
    script = (
        "import { chunkText } from './services/chunker.js';"
        "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "console.log(JSON.stringify(JSON.parse(s).map(t=>chunkText(t))))});"
    )
    assert run_node(script, texts) == [chunk_text(t) for t in texts]


def test_normalize_answer_index_matches_node():
    cases = [[0, ["a", "b", "c", "d"]], [3, ["a"] * 4], [4, ["a"] * 4], ["2", ["a"] * 4], [None, ["a"] * 4],
             ["x", ["a"] * 4], [7, []], [-1, ["a"] * 4], ["", ["a"] * 4], [2.0, ["a"] * 4]]
    script = (
        "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "function normalizeAnswerIndex(answer, options) {"
        "  const size = Array.isArray(options) ? options.length : 0; const n = Number(answer);"
        "  if (!Number.isFinite(n)) return 0; if (size > 0 && n >= 0 && n < size) return n;"
        "  if (size > 0 && n >= 1 && n <= size) return n - 1; return Math.max(0, n); }"
        "console.log(JSON.stringify(JSON.parse(s).map(([a,o])=>normalizeAnswerIndex(a,o))))});"
    )
    assert run_node(script, cases) == [normalize_answer_index(a, o) for a, o in cases]
