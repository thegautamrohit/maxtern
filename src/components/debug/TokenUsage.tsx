"use client";

import { TokenUsage as TokenUsageType } from "@/core/types";

type TokenUsageProps = {
  tokens: TokenUsageType;
};

export default function TokenUsage({ tokens }: TokenUsageProps) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Prompt tokens</span>
        <span className="font-mono">{tokens.promptTokens}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Completion tokens</span>
        <span className="font-mono">{tokens.completionTokens}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total tokens</span>
        <span className="font-mono">{tokens.totalTokens}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Est. cost</span>
        <span className="font-mono text-amber-600 dark:text-amber-400">
          {tokens.estimatedCost}
        </span>
      </div>
    </div>
  );
}
