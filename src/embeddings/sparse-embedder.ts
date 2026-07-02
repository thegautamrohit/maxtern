import { SparseVector } from "@/core/types";
import { WordTokenizer, stopwords } from "natural";

const hashWord = (word: string): number => {
  let hash = 0;
  for (const char of word) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  return hash;
};

const tokenizer = new WordTokenizer();

export const computeSparseVector = (text: string): SparseVector => {
  const tokens = tokenizer.tokenize(text.toLowerCase());

  const filteredTokens = tokens.filter((token) => !stopwords.includes(token));

  const tfMap = new Map<string, number>();

  for (const token of filteredTokens) {
    if (tfMap.has(token)) {
      tfMap.set(token, tfMap.get(token)! + 1);
    } else {
      tfMap.set(token, 1);
    }
  }

  // merge colliding indices by summing their values
  const indexMap = new Map<number, number>();

  tfMap.forEach((value, key) => {
    const idx = hashWord(key);
    indexMap.set(idx, (indexMap.get(idx) ?? 0) + value);
  });

  const indices: number[] = [];
  const values: number[] = [];

  indexMap.forEach((value, idx) => {
    indices.push(idx);
    values.push(value);
  });

  return { indices, values };
};

