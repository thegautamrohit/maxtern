import { GraphStateType } from "./state";

export const routeAfterEval = (state: GraphStateType) => {
  const { relevant } = state;

  if (!relevant) {
    return "web_search";
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
