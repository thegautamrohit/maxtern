import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from "@xenova/transformers";
import { RetrievedChunk } from "@/core/types";

// Singleton pattern — loading the model reads hundreds of MB from disk and allocates memory.
// Store on module-level variables so the model is loaded once and reused across all requests.
let tokenizer: any = null;
let model: any = null;

async function getReranker() {
  if (!tokenizer || !model) {
    tokenizer = await AutoTokenizer.from_pretrained(
      "Xenova/ms-marco-MiniLM-L-6-v2",
    );
    model = await AutoModelForSequenceClassification.from_pretrained(
      "Xenova/ms-marco-MiniLM-L-6-v2",
    );
  }
  return { tokenizer, model };
}

export const getRerankChunks = async (
  query: string,
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> => {
  const { tokenizer, model } = await getReranker();

  // Score each query-chunk pair using the cross-encoder.
  // text_pair packs query + chunk into a single input — the model attends across both simultaneously.
  // This is what makes cross-encoders more accurate than cosine similarity (bi-encoders),
  // which encode query and chunk separately and never attend across them.
  // truncation + max_length: 512 — BERT-based models have a fixed context window,
  // tokens beyond 512 are cut off rather than crashing.
  // All pairs run in parallel via Promise.all — one forward pass per chunk.
  const scores = await Promise.all(
    chunks.map(async (chunk) => {
      const input = tokenizer(query, {
        text_pair: chunk.content,
        truncation: true,
        max_length: 512,
        return_tensors: "pt",
      });
      const output = await model(input);
      // output.logits.data[0] is the raw relevance logit — unbounded, not a probability.
      // This model is a regression model (single output neuron), NOT a classifier.
      // Do NOT use the pipeline() abstraction — it applies softmax to a single value,
      // which always returns 1.0 regardless of actual relevance.
      return output.logits.data[0];
    }),
  );

  const scoredChunks = chunks.map((chunk, i) => ({
    ...chunk,
    score: scores[i],
  }));

  const sorted = scoredChunks.sort((a, b) => b.score - a.score);

  // Threshold is > 0, not > 0.5 — logits are not softmax probabilities.
  // 0 is the natural midpoint: positive = model thinks relevant, negative = not relevant.
  // Fallback to top 3 if all scores are negative — ensures the graph always has chunks
  // to pass to the evaluator rather than returning an empty array and breaking downstream nodes.
  const filtered = sorted.filter((chunk) => chunk.score > 0);

  return filtered.length > 0 ? filtered : sorted.slice(0, 3);
};
