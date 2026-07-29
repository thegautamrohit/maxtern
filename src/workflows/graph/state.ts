import { Annotation } from "@langchain/langgraph";
import { RetrievalStrategy, RetrievedChunk } from "@/core/types";
import { BaseMessage } from "@langchain/core/messages";

export const GraphState = Annotation.Root({
  query: Annotation<string>(),
  strategy: Annotation<RetrievalStrategy>(),
  queryReasoning: Annotation<string>(),
  chunks: Annotation<RetrievedChunk[]>({
    reducer: (prev, current) => current,
    default: () => [],
  }),
  answer: Annotation<string>(),
  retrievalQuality: Annotation<"correct" | "incorrect" | "ambiguous">(),
  history: Annotation<BaseMessage[]>(),
  documentIds: Annotation<string[]>(),
  userId: Annotation<string>(),
  evalReason: Annotation<string>(),
  rewrittenQuery: Annotation<string>(),
});

export type GraphStateType = typeof GraphState.State;
