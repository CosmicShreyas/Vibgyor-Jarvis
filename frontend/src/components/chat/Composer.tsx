import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, AudioLines, Paperclip, Pencil, Plus, Sparkles, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/AuthProvider";
import type { AssistantSkillId, Attachment } from "@/lib/chat-types";
import type { ChatSkillDefinition } from "@/lib/skills";
import { useVoiceAssistant } from "@/lib/use-voice-assistant";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "./AttachmentChip";
import { VoiceOrb } from "./VoiceOrb";

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

async function fileToAttachment(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: uid(),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
  if (file.type.startsWith("image/")) {
    const preview = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { ...base, preview };
  }
  return base;
}

interface Props {
  onSend: (
    content: string,
    attachments: Attachment[],
    callbacks?: {
      onAssistantDone?: (assistantText: string) => void;
      onAssistantError?: (message: string) => void;
    },
  ) => void;
  disabled?: boolean;
  skills: ChatSkillDefinition[];
  enabledSkills: AssistantSkillId[];
  skillConfigs: Partial<Record<AssistantSkillId, string>>;
  onToggleSkill: (skillId: AssistantSkillId, enabled: boolean) => void;
  onSaveSkillMarkdown: (skillId: AssistantSkillId, markdown: string) => void;
}

export function Composer({
  onSend,
  disabled,
  skills,
  enabledSkills,
  skillConfigs,
  onToggleSkill,
  onSaveSkillMarkdown,
}: Props) {
  const { token } = useAuth();
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<AssistantSkillId | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeSkillCount = enabledSkills.length;
  const editingSkill = skills.find((skill) => skill.id === editingSkillId) ?? null;
  const voiceAssistant = useVoiceAssistant({
    token,
    onSendVoiceMessage: (content, callbacks) => {
      onSend(content, [], callbacks);
    },
  });

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [value]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const slots = MAX_FILES - attachments.length;
      const accepted = arr.filter((f) => f.size <= MAX_BYTES).slice(0, slots);
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [attachments.length],
  );

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) {
      e.preventDefault();
      void addFiles(items);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
  };

  const submit = () => {
    const content = value.trim();
    if (!content && attachments.length === 0) return;
    if (disabled) return;
    onSend(content, attachments);
    setValue("");
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="px-3 pb-4 pt-1 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-2xl border border-border bg-surface-elevated shadow-elevated transition",
            dragOver && "border-foreground/40 ring-2 ring-foreground/10",
          )}
        >
          <VoiceOrb
            open={voiceAssistant.open}
            mode={voiceAssistant.mode}
            level={voiceAssistant.level}
            transcript={voiceAssistant.transcript}
            error={voiceAssistant.error}
            onClose={voiceAssistant.close}
          />

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm">
              <div className="text-sm font-medium text-foreground">Drop files to attach</div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2.5">
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.id}
                  att={a}
                  onRemove={(id) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
                />
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="Message Jarvis..."
            className="block w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Attach files"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Attach</span>
              </button>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-muted hover:text-foreground",
                      activeSkillCount > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                    aria-label="Tools"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Tools</span>
                    {activeSkillCount > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                        {activeSkillCount}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 rounded-2xl border-border/70 bg-surface-elevated p-3 shadow-elevated"
                >
                  <div className="mb-2 px-1">
                    <div className="text-sm font-semibold text-foreground">Tools & skills</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      Turn on structured skills when you want Jarvis to use a guided workflow instead of a general reply.
                    </div>
                  </div>

                  <div className="space-y-2">
                    {skills.map((skill) => {
                      const enabled = enabledSkills.includes(skill.id);
                      const currentMarkdown = skillConfigs[skill.id] ?? skill.defaultMarkdown;
                      return (
                        <div
                          key={skill.id}
                          className={cn(
                            "rounded-2xl border px-3 py-3 transition",
                            enabled
                              ? "border-primary/30 bg-primary/8"
                              : "border-border/70 bg-background/40 hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{skill.label}</div>
                              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                {skill.description}
                              </div>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => onToggleSkill(skill.id, checked)}
                              aria-label={`Toggle ${skill.label}`}
                            />
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                            <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
                              Edit the Markdown prompt that drives this skill, then save it back into the tool.
                            </div>
                            <button
                              onClick={() => {
                                setEditingSkillId(skill.id);
                                setSkillDraft(currentMarkdown);
                              }}
                              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="ml-1 hidden items-center gap-1 rounded-md border border-border/60 px-1.5 py-1 text-[10px] text-muted-foreground sm:flex">
                <Sparkles className="h-3 w-3" />
                {activeSkillCount > 0 ? `${activeSkillCount} skill active` : "Jarvis 1.0"}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={voiceAssistant.toggle}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground",
                  voiceAssistant.open && "bg-muted text-foreground",
                )}
                aria-label="Voice input"
                aria-pressed={voiceAssistant.open}
              >
                <AudioLines className="h-4 w-4" />
              </button>

              <button
                onClick={submit}
                disabled={(!value.trim() && attachments.length === 0) || disabled}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Send"
              >
                {disabled ? (
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2 text-center text-[11px] text-muted-foreground/70">
          Jarvis can make mistakes. Verify important information.
        </div>
      </div>

      <Dialog
        open={Boolean(editingSkill)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSkillId(null);
            setSkillDraft("");
          }
        }}
      >
        <DialogContent className="max-w-3xl border-border/70 bg-surface-elevated">
          <DialogHeader>
            <DialogTitle>{editingSkill?.label ?? "Edit skill"}</DialogTitle>
            <DialogDescription>
              Update the Markdown instruction for this skill. Saving will also re-enable it so the next message uses the updated version.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={skillDraft}
            onChange={(event) => setSkillDraft(event.target.value)}
            rows={22}
            className="min-h-[28rem] resize-y border-border/70 bg-background/60 font-mono text-[12px] leading-6"
          />

          <DialogFooter className="gap-2 sm:justify-between">
            <button
              onClick={() => {
                setEditingSkillId(null);
                setSkillDraft("");
              }}
              className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!editingSkill || !skillDraft.trim()) return;
                onSaveSkillMarkdown(editingSkill.id, skillDraft);
                setEditingSkillId(null);
                setSkillDraft("");
              }}
              className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            >
              Save and enable
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
