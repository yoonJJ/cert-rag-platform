export function chunkText(text, chunkSize = 650, overlap = 100) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const sentence = slice.lastIndexOf('. ');
      const word = slice.lastIndexOf(' ');
      const cut = sentence > 300 ? sentence + 1 : word > 300 ? word : slice.length;
      end = start + cut;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}
