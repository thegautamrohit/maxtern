"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

type PDFUploadProps = {
  onIngest: (source: string, file: File) => void;
  disabled?: boolean;
};

export default function PDFUpload({ onIngest, disabled }: PDFUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="flex items-center gap-2 w-full rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer"
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {file ? file.name : "Click to select a PDF"}
        </span>
      </button>

      <Button
        onClick={() => file && onIngest(file.name, file)}
        disabled={disabled || !file}
        className="w-full"
      >
        Ingest PDF
      </Button>
    </div>
  );
}
