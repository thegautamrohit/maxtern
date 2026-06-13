"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Globe, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import PDFUpload from "./PDFUpload";
import URLInput from "./URLInput";
import GitHubInput from "./GitHubInput";

type SourceType = "pdf" | "website" | "github" | null;

type SourceSelectorProps = {
  onIngest: (type: "pdf" | "website" | "github", source: string, branch?: string) => void;
  onSkip: () => void;
  disabled?: boolean;
};

const sources = [
  { type: "pdf" as const, label: "PDF", icon: FileText },
  { type: "website" as const, label: "Website", icon: Globe },
  { type: "github" as const, label: "GitHub", icon: GitBranch },
];

export default function SourceSelector({ onIngest, onSkip, disabled }: SourceSelectorProps) {
  const [selected, setSelected] = useState<SourceType>(null);

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto w-full">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Add a source</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ingest a document to chat with, or skip to ask anything.
        </p>
      </div>

      {/* Source type buttons */}
      <div className="flex gap-3 w-full">
        {sources.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => setSelected(selected === type ? null : type)}
            disabled={disabled}
            className={cn(
              "flex-1 flex flex-col items-center gap-1.5 rounded-xl border border-border py-3 px-2 text-xs font-medium transition-colors hover:bg-accent",
              selected === type && "border-primary bg-primary/5 text-primary",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      {/* Selected source input */}
      {selected === "pdf" && (
        <div className="w-full">
          <PDFUpload
            onIngest={(source) => onIngest("pdf", source)}
            disabled={disabled}
          />
        </div>
      )}
      {selected === "website" && (
        <div className="w-full">
          <URLInput
            onIngest={(source) => onIngest("website", source)}
            disabled={disabled}
          />
        </div>
      )}
      {selected === "github" && (
        <div className="w-full">
          <GitHubInput
            onIngest={(source, branch) => onIngest("github", source, branch)}
            disabled={disabled}
          />
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={onSkip} disabled={disabled}>
        Skip — just ask anything
      </Button>
    </div>
  );
}
