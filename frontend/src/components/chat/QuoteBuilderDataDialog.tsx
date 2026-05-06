import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchQuoteBuilderConfig, updateQuoteBuilderConfig } from "@/lib/api";
import type { QuoteBuilderConfig, QuoteBuilderPricingItem } from "@/lib/quote-builder-types";
import { cn } from "@/lib/utils";

const DEFAULT_GROUPS = ["Main Modules", "Ancillary Modules"];

function modulesToTextarea(value: string[] | undefined) {
  return (value ?? []).join("\n");
}

function textareaToModules(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPricingItems(value: QuoteBuilderPricingItem[]) {
  return JSON.stringify(value, null, 2);
}

function parsePricingItems(value: string): QuoteBuilderPricingItem[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Pricing JSON must be an array.");
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Pricing item ${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    return {
      carcase_core: String(record.carcase_core ?? "").trim(),
      carcase_finish: String(record.carcase_finish ?? "").trim(),
      shutter_core: String(record.shutter_core ?? "").trim(),
      shutter_finish: String(record.shutter_finish ?? "").trim(),
      price: Number(record.price ?? 0),
    };
  });
}

export function QuoteBuilderDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { token } = useAuth();
  const [config, setConfig] = useState<QuoteBuilderConfig | null>(null);
  const [pricingJson, setPricingJson] = useState("[]");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    setError(null);
    void fetchQuoteBuilderConfig(token)
      .then((result) => {
        setConfig(result);
        setPricingJson(formatPricingItems(result.pricing_items));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load quote builder data");
      })
      .finally(() => setLoading(false));
  }, [open, token]);

  const groups = useMemo(() => {
    const existing = config ? Object.keys(config.modules_by_group) : [];
    return Array.from(new Set([...DEFAULT_GROUPS, ...existing]));
  }, [config]);

  const updateModuleGroup = (group: string, value: string) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            modules_by_group: {
              ...prev.modules_by_group,
              [group]: textareaToModules(value),
            },
          }
        : prev,
    );
  };

  const onSave = () => {
    if (!token || !config) return;
    let pricingItems: QuoteBuilderPricingItem[];
    try {
      pricingItems = parsePricingItems(pricingJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid pricing JSON");
      return;
    }

    const nextConfig: QuoteBuilderConfig = {
      ...config,
      pricing_items: pricingItems,
    };

    setSaving(true);
    setError(null);
    void updateQuoteBuilderConfig(nextConfig, token)
      .then((result) => {
        setConfig(result);
        setPricingJson(formatPricingItems(result.pricing_items));
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to save quote builder data");
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,920px)] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden border-border/70 bg-surface-elevated p-0">
        <div className="flex shrink-0 flex-col gap-4 border-b border-border/70 px-6 py-5">
          <DialogHeader>
            <DialogTitle>Quote Builder Data</DialogTitle>
            <DialogDescription>
              Edit modules and the simplified pricing JSON here. Changes are saved to MongoDB and used by the quote skill immediately.
            </DialogDescription>
          </DialogHeader>
        </div>

        {loading ? (
          <div className="flex min-h-[24rem] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading quote builder data...
          </div>
        ) : config ? (
          <Tabs defaultValue="pricing" className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
            <TabsList className="shrink-0 self-start">
              <TabsTrigger value="pricing">Pricing</TabsTrigger>
              <TabsTrigger value="modules">Modules</TabsTrigger>
            </TabsList>

            <TabsContent value="pricing" className="mt-4 min-h-0 flex-1 overflow-auto">
              <div className="rounded-2xl border border-border/70 bg-background/30 p-4">
                <div className="mb-3 text-sm font-medium text-foreground">Pricing JSON</div>
                <Textarea
                  value={pricingJson}
                  onChange={(event) => setPricingJson(event.target.value)}
                  rows={24}
                  className={cn(
                    "min-h-[28rem] resize-y border-border/70 bg-background/60 font-mono text-xs leading-6",
                  )}
                />
                <div className="mt-3 text-xs text-muted-foreground">
                  Each item should contain `carcase_core`, `carcase_finish`, `shutter_core`, `shutter_finish`, and `price`.
                </div>
              </div>
            </TabsContent>

            <TabsContent value="modules" className="mt-4 min-h-0 flex-1 overflow-auto">
              <div className="grid gap-4 md:grid-cols-2">
                {groups.map((group) => (
                  <div key={group} className="rounded-2xl border border-border/70 bg-background/30 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">{group}</div>
                    <Textarea
                      value={modulesToTextarea(config.modules_by_group[group])}
                      onChange={(event) => updateModuleGroup(group, event.target.value)}
                      rows={18}
                      className={cn(
                        "min-h-[22rem] resize-y border-border/70 bg-background/60 text-sm leading-6",
                      )}
                    />
                    <div className="mt-2 text-xs text-muted-foreground">
                      One module per line.
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted-foreground">
            {error ?? "No quote builder data found."}
          </div>
        )}

        <div className="shrink-0 border-t border-border/70 px-6 py-4">
          {error && config && <div className="mb-3 text-sm text-destructive">{error}</div>}
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Pricing JSON and modules are saved live to MongoDB and used by Quote Builder.
            </div>
            <button
              onClick={onSave}
              disabled={!config || saving}
              className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
