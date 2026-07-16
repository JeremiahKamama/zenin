import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { zeninFetch } from "../utils/zeninFetch";

const DECISIONS = [
  { value: "BUY", label: "Increase" },
  { value: "SELL", label: "Reduce" },
  { value: "EXIT", label: "Exit" },
  { value: "HOLD", label: "Hold" },
];

const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5, 6];

const EMOTIONS = [
  { value: "calm", label: "Calm" },
  { value: "neutral", label: "Neutral" },
  { value: "confident", label: "Confident" },
  { value: "hesitant", label: "Hesitant" },
  { value: "fomo", label: "FOMO" },
  { value: "revenge", label: "Revenge" },
  { value: "disciplined", label: "Disciplined" },
  { value: "fearful", label: "Fearful" },
];

const STRATEGIES = [
  "Value", "Growth", "Momentum", "Breakout", "Mean Reversion",
  "Swing", "Scalp", "Income", "Trend Following", "Arbitrage",
  "Event Driven", "Pairs Trade",
];

export default function DecisionComposer({
  open,
  onClose,
  onSave,
  entryDraft,
  setEntryDraft,
  editingEntryId,
  journalThreadContext,
}) {
  const [assetSearch, setAssetSearch] = useState("");
  const [assetResults, setAssetResults] = useState([]);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetFocused, setAssetFocused] = useState(false);
  const [strategySearch, setStrategySearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [dragover, setDragover] = useState(false);
  const searchRef = useRef(null);
  const searchTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const contentRef = useRef(null);

  const setField = useCallback(
    (field, value) => setEntryDraft((prev) => ({ ...prev, [field]: value })),
    [setEntryDraft]
  );

  const triggeredByThread = journalThreadContext?.symbol;

  useEffect(() => {
    if (triggeredByThread && !entryDraft.symbol) {
      setField("symbol", triggeredByThread);
      setField("decisionThreadId", journalThreadContext.id || null);
    }
  }, [triggeredByThread]);

  useEffect(() => {
    if (!open) {
      setAssetSearch("");
      setAssetResults([]);
      setShowAdvanced(false);
      setAttachments([]);
    }
  }, [open]);

  useEffect(() => {
    if (!assetSearch.trim()) {
      setAssetResults([]);
      return;
    }
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setAssetLoading(true);
      try {
        const res = await zeninFetch(
          `/search?q=${encodeURIComponent(assetSearch.trim())}&type=tradfi`,
          { signal: null }
        );
        const data = await res.json();
        if (res.ok) {
          setAssetResults((data?.results || []).slice(0, 8));
        }
      } catch {
        // ponytail: graceful fallback, no results shown
      } finally {
        setAssetLoading(false);
      }
    }, 180);
    return () => clearTimeout(searchTimerRef.current);
  }, [assetSearch]);

  const selectAsset = useCallback(
    (asset) => {
      setField("symbol", asset.symbol);
      setField("marketType", asset.marketType || "equity");
      setAssetSearch(asset.symbol);
      setAssetResults([]);
      setAssetFocused(false);
    },
    [setField]
  );

  const filteredStrategies = useMemo(() => {
    if (!strategySearch.trim()) return STRATEGIES;
    const q = strategySearch.toLowerCase();
    return STRATEGIES.filter((s) => s.toLowerCase().includes(q));
  }, [strategySearch]);

  useEffect(() => {
    if (!open) return;
    const handler = (event) => {
      if (event.key === "Escape") onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, entryDraft, editingEntryId]);

  useEffect(() => {
    if (!open) return;
    const hasSymbol = String(entryDraft.symbol || "").trim();
    const hasDecision = String(entryDraft.side || "").trim();
    const hasConfidence = Number(entryDraft.confidence) >= 1;
    if (hasSymbol && hasDecision && hasConfidence && !showAdvanced) {
      setShowAdvanced(true);
    }
  }, [entryDraft.symbol, entryDraft.side, entryDraft.confidence, open]);

  const handleSave = useCallback(() => {
    if (!String(entryDraft.symbol || "").trim()) return;
    if (!String(entryDraft.side || "").trim()) return;
    onSave({ attachments });
  }, [entryDraft, onSave, attachments]);

  const handleFileDrop = useCallback((event) => {
    event.preventDefault();
    setDragover(false);
    const files = Array.from(event.dataTransfer?.files || []);
    setAttachments((prev) => [...prev, ...files]);
  }, []);

  const handleFileSelect = useCallback((event) => {
    const files = Array.from(event.target?.files || []);
    setAttachments((prev) => [...prev, ...files]);
    event.target.value = "";
  }, []);

  const handlePaste = useCallback((event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) setAttachments((prev) => [...prev, file]);
      }
    }
  }, []);

  const removeAttachment = useCallback((index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50",
            "bg-[var(--color-surface-overlay)] backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "duration-200"
          )}
        />
        <DialogPrimitive.Content
          ref={contentRef}
          onPaste={handlePaste}
          onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragover(false); }}
          onDrop={handleFileDrop}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[min(760px,94vw)] max-h-[85vh]",
            "rounded-2xl border border-[var(--color-border-subtle)]",
            "bg-[var(--color-surface-elevated)]",
            "shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_80px_rgba(0,0,0,0.64)]",
            "flex flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200"
          )}
        >
          {/* Header */}
          <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
                  Record Decision
                </h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                  Capture your thesis before the market changes it.
                </p>
              </div>
              <DialogPrimitive.Close
                onClick={onClose}
                className="rounded-lg p-1.5 opacity-50 hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-[opacity,background] duration-150"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </DialogPrimitive.Close>
            </div>
            {entryDraft.symbol && (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
                <span className="px-2 py-0.5 rounded-md bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] font-medium font-mono text-xs">
                  {entryDraft.symbol}
                </span>
                {entryDraft.marketType && (
                  <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
                    {entryDraft.marketType}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* ---- Asset ---- */}
            <SectionLabel>Asset</SectionLabel>
            <div ref={searchRef} className="relative">
              <input
                type="text"
                value={assetSearch || entryDraft.symbol}
                onChange={(e) => {
                  const val = e.target.value;
                  setAssetSearch(val);
                  setField("symbol", val.toUpperCase());
                  setAssetFocused(true);
                }}
                onFocus={() => setAssetFocused(true)}
                onBlur={() => setTimeout(() => setAssetFocused(false), 150)}
                placeholder="Search by symbol or name..."
                className={cn(
                  "w-full h-[42px] rounded-lg px-3.5 text-sm",
                  "bg-[var(--color-surface-depth)]",
                  "border border-[var(--color-border-subtle)]",
                  "text-[var(--color-text-primary)]",
                  "placeholder:text-[var(--color-text-dim)]",
                  "focus:outline-none focus:border-[var(--color-focus)] focus:ring-1 focus:ring-[var(--color-focus)]",
                  "transition-[border,box-shadow] duration-150"
                )}
              />
              {assetLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-[var(--color-text-dim)] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {assetFocused && assetResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] shadow-lg overflow-hidden">
                  {assetResults.map((asset) => (
                    <button
                      key={asset.symbol}
                      type="button"
                      onClick={() => selectAsset(asset)}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-[var(--color-surface-hover)] transition-colors duration-100 flex items-center justify-between group"
                    >
                      <div>
                        <span className="text-[var(--color-text-primary)] font-medium">
                          {asset.symbol}
                        </span>
                        <span className="ml-2 text-[var(--color-text-muted)] text-xs">
                          {asset.name}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100 transition-opacity">
                        {asset.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ---- Decision ---- */}
            <SectionLabel>Decision</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {DECISIONS.map((d) => {
                const isActive = entryDraft.side === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setField("side", isActive ? "" : d.value)}
                    className={cn(
                      "h-[42px] rounded-lg text-sm font-semibold transition-colors duration-150 border cursor-pointer",
                      isActive
                        ? d.value === "BUY"
                          ? "border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.10)] text-emerald-400"
                          : d.value === "SELL" || d.value === "EXIT"
                            ? "border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.10)] text-red-400"
                            : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] text-[var(--color-text-primary)]"
                        : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-medium)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>

            {/* ---- Confidence ---- */}
            <SectionLabel>Confidence</SectionLabel>
            <div className="flex items-center gap-2.5">
              {CONFIDENCE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setField("confidence", level)}
                  className={cn(
                    "w-10 h-10 rounded-lg text-sm font-semibold transition-colors duration-150 border cursor-pointer",
                    entryDraft.confidence === level
                      ? "border-[var(--color-focus)] bg-[var(--color-focus)] text-[var(--color-text-inverse)]"
                      : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-medium)] hover:text-[var(--color-text-secondary)]"
                  )}
                >
                  {level}
                </button>
              ))}
              <span className="ml-2 text-[11px] uppercase tracking-wider text-[var(--color-text-dim)] select-none">
                {entryDraft.confidence <= 2 ? "Low" : entryDraft.confidence <= 4 ? "Medium" : "High"}
              </span>
            </div>

            {/* Progressive disclosure: show advanced fields once core fields are filled */}
            {showAdvanced && (
              <>
                <div className="h-px bg-[var(--color-border-subtle)]" />

                {/* ---- Strategy + Emotion ---- */}
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <SectionLabel>Strategy</SectionLabel>
                    <div className="relative">
                      <input
                        type="text"
                        value={strategySearch || entryDraft.strategy}
                        onChange={(e) => {
                          setStrategySearch(e.target.value);
                          setField("strategy", e.target.value);
                        }}
                        placeholder="Search strategy..."
                        className={cn(
                          "w-full h-[38px] rounded-lg px-3 text-sm",
                          "bg-[var(--color-surface-depth)]",
                          "border border-[var(--color-border-subtle)]",
                          "text-[var(--color-text-primary)]",
                          "placeholder:text-[var(--color-text-dim)]",
                          "focus:outline-none focus:border-[var(--color-focus)] focus:ring-1 focus:ring-[var(--color-focus)]",
                          "transition-[border,box-shadow] duration-150"
                        )}
                      />
                      {!entryDraft.strategy && !strategySearch && (
                        <div className="absolute top-full mt-1 left-0 right-0 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] shadow-lg overflow-hidden p-1.5">
                          <div className="flex flex-wrap gap-1">
                            {STRATEGIES.slice(0, 6).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setField("strategy", s)}
                                className="px-2.5 py-1 rounded-md text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors duration-100"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {strategySearch && filteredStrategies.length > 0 && (
                        <div className="absolute top-full mt-1 left-0 right-0 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] shadow-lg overflow-hidden p-1.5">
                          <div className="flex flex-wrap gap-1">
                            {filteredStrategies.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setField("strategy", s);
                                  setStrategySearch("");
                                }}
                                className="px-2.5 py-1 rounded-md text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors duration-100"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <SectionLabel>Emotion</SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {EMOTIONS.map((em) => {
                        const isActive = entryDraft.emotion === em.value;
                        return (
                          <button
                            key={em.value}
                            type="button"
                            onClick={() =>
                              setField("emotion", isActive ? "" : em.value)
                            }
                            className={cn(
                              "px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors duration-150 border cursor-pointer",
                              isActive
                                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                                : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-medium)] hover:text-[var(--color-text-secondary)]"
                            )}
                          >
                            {em.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ---- Timeframe ---- */}
                <SectionLabel>Timeframe</SectionLabel>
                <div className="flex gap-2">
                  {["intraday", "swing", "position"].map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() =>
                        setField("timeframe", entryDraft.timeframe === tf ? "" : tf)
                      }
                      className={cn(
                        "px-4 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-colors duration-150 border cursor-pointer",
                        entryDraft.timeframe === tf
                          ? "border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                          : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-medium)] hover:text-[var(--color-text-secondary)]"
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                <div className="h-px bg-[var(--color-border-subtle)]" />

                {/* ---- Investment Thesis ---- */}
                <div>
                  <SectionLabel>Investment Thesis</SectionLabel>
                  <textarea
                    value={entryDraft.preThesis || ""}
                    onChange={(e) => setField("preThesis", e.target.value)}
                    placeholder="Why are you making this decision?\n\nWhat catalyst are you expecting?\n\nWhat would invalidate this thesis?"
                    rows={5}
                    className={cn(
                      "w-full rounded-lg px-3.5 py-3 text-sm resize-y",
                      "bg-[var(--color-surface-depth)]",
                      "border border-[var(--color-border-subtle)]",
                      "text-[var(--color-text-primary)]",
                      "placeholder:text-[var(--color-text-dim)]",
                      "focus:outline-none focus:border-[var(--color-focus)] focus:ring-1 focus:ring-[var(--color-focus)]",
                      "transition-[border,box-shadow] duration-150",
                      "leading-relaxed"
                    )}
                  />
                </div>

                {/* ---- Notes ---- */}
                <div>
                  <SectionLabel>Notes</SectionLabel>
                  <textarea
                    value={entryDraft.postReview || ""}
                    onChange={(e) => setField("postReview", e.target.value)}
                    placeholder="Any additional notes on this decision..."
                    rows={3}
                    className={cn(
                      "w-full rounded-lg px-3.5 py-3 text-sm resize-y",
                      "bg-[var(--color-surface-depth)]",
                      "border border-[var(--color-border-subtle)]",
                      "text-[var(--color-text-primary)]",
                      "placeholder:text-[var(--color-text-dim)]",
                      "focus:outline-none focus:border-[var(--color-focus)] focus:ring-1 focus:ring-[var(--color-focus)]",
                      "transition-[border,box-shadow] duration-150",
                      "leading-relaxed"
                    )}
                  />
                </div>

                {/* ---- Evidence / Attachments ---- */}
                <div>
                  <SectionLabel>Evidence</SectionLabel>
                  <div
                    className={cn(
                      "relative rounded-lg border border-dashed p-5 text-center transition-colors duration-150",
                      dragover
                        ? "border-[var(--color-focus)] bg-[rgba(255,255,255,0.04)]"
                        : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-medium)]"
                    )}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="text-[13px] text-[var(--color-text-muted)]">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        Upload files
                      </button>
                      <span className="mx-1">or drag-and-drop</span>
                      <span className="text-[var(--color-text-dim)] text-[11px] block mt-1">
                        Paste from clipboard also supported
                      </span>
                    </div>
                  </div>
                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {attachments.map((file, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--color-surface-depth)] border border-[var(--color-border-subtle)] text-[13px]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-[var(--color-text-dim)]">
                              <rect x="2" y="1" width="10" height="12" rx="1" />
                              <line x1="4" y1="4" x2="10" y2="4" />
                              <line x1="4" y1="7" x2="10" y2="7" />
                              <line x1="4" y1="10" x2="7" y2="10" />
                            </svg>
                            <span className="truncate text-[var(--color-text-secondary)]">
                              {file.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-[var(--color-text-dim)]">
                              {formatFileSize(file.size)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAttachment(idx)}
                            className="shrink-0 ml-2 p-1 rounded-md opacity-50 hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-colors duration-100"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <line x1="3" y1="3" x2="9" y2="9" />
                              <line x1="9" y1="3" x2="3" y2="9" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ---- Setup Tag ---- */}
                <div>
                  <SectionLabel>Setup Tag</SectionLabel>
                  <input
                    type="text"
                    value={entryDraft.setupTag || ""}
                    onChange={(e) => setField("setupTag", e.target.value)}
                    placeholder="e.g., Earnings play, Fed meeting, CPI print..."
                    className={cn(
                      "w-full h-[38px] rounded-lg px-3.5 text-sm",
                      "bg-[var(--color-surface-depth)]",
                      "border border-[var(--color-border-subtle)]",
                      "text-[var(--color-text-primary)]",
                      "placeholder:text-[var(--color-text-dim)]",
                      "focus:outline-none focus:border-[var(--color-focus)] focus:ring-1 focus:ring-[var(--color-focus)]",
                      "transition-[border,box-shadow] duration-150"
                    )}
                  />
                </div>
              </>
            )}

            {/* Show/hide toggle when advanced is collapsed */}
            {!showAdvanced && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(true)}
                  className="text-[12px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors underline underline-offset-2"
                >
                  Show all fields
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-depth)] flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "h-[38px] px-4 rounded-lg text-sm font-medium",
                "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
                "hover:bg-[var(--color-surface-hover)] transition-colors duration-150"
              )}
            >
              Cancel
            </button>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--color-text-dim)] hidden sm:inline">
                ⌘ Enter
              </span>
              <button
                type="button"
                onClick={handleSave}
                disabled={
                  !String(entryDraft.symbol || "").trim() ||
                  !String(entryDraft.side || "").trim()
                }
                className={cn(
                  "h-[38px] px-5 rounded-lg text-sm font-semibold transition-colors duration-150",
                  String(entryDraft.symbol || "").trim() &&
                    String(entryDraft.side || "").trim()
                    ? "bg-[var(--color-interactive)] text-[var(--color-text-inverse)] hover:bg-[var(--color-interactive-hover)]"
                    : "bg-[var(--color-surface-hover)] text-[var(--color-text-dim)] cursor-not-allowed"
                )}
              >
                {editingEntryId ? "Update Decision" : "Save Decision"}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-dim)] mb-1.5 select-none">
      {children}
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
