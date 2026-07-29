import { SparseVector } from "@/core/types";
import { WordTokenizer, stopwords } from "natural";

// Maps a word to a number between 0 and 99,999 using a polynomial rolling hash.
// Same word always produces the same number — required for consistent Qdrant indexing.
// Modulo 100,000 bounds the index space. Two different words can produce the same number
// (hash collision) — handled downstream by summing their term frequencies.
const hashWord = (word: string): number => {
  let hash = 0;
  for (const char of word) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  return hash;
};

const tokenizer = new WordTokenizer();

// Converts text into a BM25-style sparse vector: { indices, values }.
// Sparse format stores only non-zero positions — most words don't appear in a given chunk,
// so storing all 100,000 possible positions as zeros would waste memory.
// Qdrant uses dot product to compare sparse vectors — only words that appear in BOTH
// the query and the chunk contribute to the score. Everything else scores zero.
export const computeSparseVector = (text: string): SparseVector => {
  // Step 1 — Tokenize and lowercase
  const tokens = tokenizer.tokenize(text.toLowerCase());

  // Step 2 — Remove stopwords ("the", "is", "a", etc.)
  // Common words appear in every chunk — they carry no discriminative signal.
  // Removing them reduces noise and keeps the sparse vector compact.
  const filteredTokens = tokens.filter((token) => !stopwords.includes(token));

  // Step 3 — Count term frequency (TF) per word
  // TF = how many times a word appears in this text. Higher TF = higher relevance signal.
  const tfMap = new Map<string, number>();

  for (const token of filteredTokens) {
    if (tfMap.has(token)) {
      tfMap.set(token, tfMap.get(token)! + 1);
    } else {
      tfMap.set(token, 1);
    }
  }

  // Step 4 — Hash each word to an index and handle collisions.
  // Two words can hash to the same index — collision is resolved by summing their TF counts
  // rather than storing duplicate indices (Qdrant rejects duplicate indices in a sparse vector).
  const indexMap = new Map<number, number>();

  tfMap.forEach((value, key) => {
    const idx = hashWord(key);
    indexMap.set(idx, (indexMap.get(idx) ?? 0) + value);
  });

  // Step 5 — Flatten to parallel arrays (Qdrant sparse vector format)
  const indices: number[] = [];
  const values: number[] = [];

  indexMap.forEach((value, idx) => {
    indices.push(idx);
    values.push(value);
  });

  return { indices, values };
};

