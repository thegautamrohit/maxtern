"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GitHubInputProps = {
  onIngest: (source: string, branch: string) => void;
  disabled?: boolean;
};

export default function GitHubInput({ onIngest, disabled }: GitHubInputProps) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={disabled}
      />
      <Input
        placeholder="Branch (default: main)"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        disabled={disabled}
      />
      <Button
        onClick={() => onIngest(url.trim(), branch.trim())}
        disabled={disabled || !url.trim()}
        className="w-full"
      >
        Ingest Repository
      </Button>
    </div>
  );
}
