/**
 * DropZone.tsx
 * Reusable drag-and-drop / click-to-upload file zone.
 */

import { useState, type DragEvent, type RefObject } from "react";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export type DropStatus = "idle" | "loading" | "done" | "error";

interface Props {
  label:      string;
  hint:       string;
  accept:     string;
  status:     DropStatus;
  statusText: string;
  inputRef:   RefObject<HTMLInputElement | null>;
  onFile:     (file: File) => void;
  children?:  React.ReactNode;
}

export default function DropZone({
  label, hint, accept, status, statusText, inputRef, onFile, children,
}: Props) {
  const [over, setOver] = useState(false);

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  const borderColor =
    status === "done"  ? "#22c55e" :
    status === "error" ? "#ef4444" :
    over               ? "#3b82f6" : "#cbd5e1";

  const statusColor =
    status === "done"  ? "#16a34a" :
    status === "error" ? "#dc2626" : "#64748b";

  const StatusIcon =
    status === "loading" ? Loader2 :
    status === "done"    ? CheckCircle2 :
    status === "error"   ? XCircle : Upload;

  return (
    <div
      className="rounded-2xl p-5 cursor-pointer transition-colors select-none"
      style={{
        background:   over ? "#f0f7ff" : "white",
        border:       `2px dashed ${borderColor}`,
        boxShadow:    "0 1px 4px rgba(0,0,0,0.06)",
        transition:   "border-color 0.15s, background 0.15s",
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef as RefObject<HTMLInputElement>}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-start gap-3">
        <div
          className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: 44, height: 44, background: "#eff6ff" }}
        >
          <StatusIcon
            size={20}
            color="#3b82f6"
            className={status === "loading" ? "animate-spin" : ""}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm mb-0.5" style={{ color: "#1e293b" }}>
            {label}
          </p>
          <p className="text-xs" style={{ color: "#94a3b8" }}>{hint}</p>

          <p
            className="mt-1.5 text-xs font-medium"
            style={{ color: statusColor }}
          >
            {statusText}
          </p>

          {children}
        </div>
      </div>
    </div>
  );
}
