import { useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

function CodeBlock({ children, className }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const text =
    typeof children === "object" && children && "props" in children
      ? // @ts-expect-error react-markdown passes a code element child
        String(children.props.children ?? "")
      : "";
  const langMatch =
    typeof children === "object" && children && "props" in children
      ? // @ts-expect-error className may exist on code child
        /language-(\w+)/.exec(children.props.className ?? "")
      : null;
  const lang = langMatch?.[1];

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="group relative my-3">
      {lang && (
        <div className="absolute left-3 top-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {lang}
        </div>
      )}
      <button
        onClick={onCopy}
        className="absolute right-2 top-2 flex h-7 items-center gap-1 rounded-md border border-border/30 bg-background/20 px-2 text-[11px] text-foreground/70 opacity-0 backdrop-blur transition hover:bg-background/40 group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className={className}>{children}</pre>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
