import { FileText, X, ImageIcon } from "lucide-react";
import type { Attachment } from "@/lib/chat-types";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentChip({
  att,
  onRemove,
}: {
  att: Attachment;
  onRemove?: (id: string) => void;
}) {
  const isImage = att.type.startsWith("image/") && att.preview;

  if (isImage) {
    return (
      <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        <img src={att.preview} alt={att.name} className="h-full w-full object-cover" />
        {onRemove && (
          <button
            onClick={() => onRemove(att.id)}
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur transition group-hover:opacity-100"
            aria-label="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="group relative flex h-16 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 pr-8 shadow-soft">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {att.type.startsWith("image/") ? (
          <ImageIcon className="h-4 w-4" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 max-w-[180px]">
        <div className="truncate text-xs font-medium text-foreground">{att.name}</div>
        <div className="text-[10px] text-muted-foreground">{formatBytes(att.size)}</div>
      </div>
      {onRemove && (
        <button
          onClick={() => onRemove(att.id)}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition hover:bg-muted hover:text-foreground"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
