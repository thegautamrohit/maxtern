"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PDFUploadProps = {
  onIngest: (source: string) => void;
  disabled?: boolean;
};

export default function PDFUpload({ onIngest, disabled }: PDFUploadProps) {
  const [path, setPath] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Enter PDF file path (e.g. /Users/you/doc.pdf)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        disabled={disabled}
      />
      <Button
        onClick={() => onIngest(path.trim())}
        disabled={disabled || !path.trim()}
        className="w-full"
      >
        Ingest PDF
      </Button>
    </div>
  );
}
