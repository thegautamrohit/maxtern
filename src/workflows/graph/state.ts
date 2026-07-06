import { Annotation } from "@langchain/langgraph";
import { RetrievalStrategy, RetrievedChunk } from "@/core/types";
import { BaseMessage } from "@langchain/core/messages";

export const GraphState = Annotation.Root({
  query: Annotation<string>(),
  strategy: Annotation<RetrievalStrategy>(),
  chunks: Annotation<RetrievedChunk[]>({
    reducer: (prev, current) => current,
    default: () => [],
  }),
  answer: Annotation<string>(),
  relevant: Annotation<boolean>(),
  history: Annotation<BaseMessage[]>(),
  documentIds: Annotation<string[]>(),
});

export type GraphStateType = typeof GraphState.State;
