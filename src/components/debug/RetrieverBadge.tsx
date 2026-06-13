"use client";

import { Badge } from "@/components/ui/badge";
import { RetrievalStrategy } from "@/core/types";

type RetrieverBadgeProps = {
  strategy: RetrievalStrategy;
  reasons: string[];
};

export default function RetrieverBadge({ strategy, reasons }: RetrieverBadgeProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={strategy === "semantic" ? "default" : "secondary"}
        className="text-xs"
      >
        {strategy}
      </Badge>
      {reasons.map((reason, i) => (
        <span key={i} className="text-xs text-muted-foreground">
          {reason}
        </span>
      ))}
    </div>
  );
}
