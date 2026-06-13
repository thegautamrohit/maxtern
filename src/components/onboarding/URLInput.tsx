"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type URLInputProps = {
  onIngest: (source: string) => void;
  disabled?: boolean;
};

export default function URLInput({ onIngest, disabled }: URLInputProps) {
  const [url, setUrl] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="https://example.com/docs"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={disabled}
        type="url"
      />
      <Button
        onClick={() => onIngest(url.trim())}
        disabled={disabled || !url.trim()}
        className="w-full"
      >
        Ingest Website
      </Button>
    </div>
  );
}
