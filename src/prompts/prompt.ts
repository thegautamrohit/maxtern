import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";

export const qaPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using ONLY the context below.
    If the answer is not present in the context, say: "I don't have enough information in the provided document."
    Answer briefly and clearly.

Context:
{context}`,
  ],
  new MessagesPlaceholder("history"),
  ["human", "{userQuery}"],
]);

export const generalPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are a helpful, knowledgeable assistant.Answer the following question clearly and concisely. Do not mention documents or context — just answer directly",
  ],
  new MessagesPlaceholder("history"),
  ["human", "{userQuery}"],
]);

export const evaluationPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a retrieval quality evaluator for a RAG system.

      Your job is to classify the retrieved chunks into one of three states, based on whether they contain enough information to answer the user's query.

      ## Query
      {query}

      ## Retrieved Chunks
      {chunksContext}

      ## Classification Rules
      - "correct" → chunks directly and sufficiently address the query. No web search needed.
      - "incorrect" → chunks are off-topic, unrelated, or the query concerns recent events/current affairs/time-sensitive info your knowledge base cannot cover. Web search should fully replace these chunks.
      - "ambiguous" → chunks are on the right topic but partially incomplete, missing specific details, or only some of the chunks are useful. Web search should supplement, not replace, these chunks.

      ## Response
      Respond with JSON only. No explanation outside the JSON.

      {{
        "retrievalQuality": "correct" | "incorrect" | "ambiguous",
        "reason": "one line — why this classification"
      }}
`,
  ],
]);

export const queryIntentPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a query intent classifier and query rewriter for a Retrieval-Augmented Generation (RAG) system.

        You have two jobs:

        1. REWRITE: If the user's query relies on prior conversation (pronouns like "it", "that", implicit references, follow-up phrasing), rewrite it as a standalone query with all references resolved using the conversation history below. If the query is already standalone, or there is no history, return it unchanged.

        2. CLASSIFY: Determine the most appropriate retrieval strategy for the (rewritten) query.

        Return one of:

        1. semantic
        Use when the user is asking for:
        - a specific fact
        - a definition
        - an implementation detail
        - a function/class explanation
        - a comparison
        - a configuration value
        - debugging help
        - code behavior

        Examples:
        - What is JWT?
        - How does authentication middleware work?
        - What does processChunk() do?
        - What port does Qdrant run on?
        - Difference between dense and sparse vectors?

        2. summary
        Use when the user wants a broad understanding of an entire topic, document, module, workflow, architecture, or codebase.

        Examples:
        - Summarize this document.
        - Give me an overview of this codebase.
        - Walk me through the architecture.
        - Explain the ingestion pipeline.
        - What is this repository about?
        - Explain authentication from start to finish.

        Rules:
        - Classify based on user intent, not only keywords.
        - If uncertain, choose semantic.

        Return ONLY valid JSON:

        {{
          "rewrittenQuery": "standalone version of the query",
          "strategy": "semantic" | "summary",
          "confidence": 0.0-1.0,
          "reasoning": "One short sentence."
        }}
`,
  ],
  new MessagesPlaceholder("history"),
  ["human", "{query}"],
]);
