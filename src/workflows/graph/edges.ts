import { GraphStateType } from "./state";

export const routeAfterEval = (state: GraphStateType) => {
  const { attempts, score } = state;

  if (score < 0.5 && attempts < 3) {
    return "retry";
  }

  return "generate";
};

export const routeAfterAnalyzer = (state: GraphStateType) => {
  const { documentIds } = state;
  if (documentIds && documentIds.length > 0) {
    return "retrieve";
  }
  return "generate";
};
