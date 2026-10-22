"use client";

import { useCallback, useEffect, useState } from "react";

export interface ToolSpec {
  key: string;
  label: string;
  content: React.ReactNode;
  command?: string;
  value?: string;
  active?: (doc: Document) => boolean;
  onRun?: (editor: HTMLDivElement) => void;
  buttonClassName?: string;
}

const TOOLBAR_BUTTON_CLASS =
  "h-[30px] w-8 cursor-pointer rounded-[7px] border border-border text-[13px] text-text disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The contenteditable + toolbar extracted from Notes (F-013 shared editor).
 * document.execCommand is deprecated but remains the sanctioned way to drive a
 * contenteditable here without an editor library (Phase 5 brief; spec §Shared
 * editor). The div is UNCONTROLLED: React renders no children inside it; the
 * parent loads markup imperatively via editorRef, once per document, and the
 * server is always the real sanitiser.
 */
export default function RichTextEditor({
  tools,
  statusText,
  placeholder,
  ariaLabel,
  editorId,
  editorRef,
  onInput,
  onBlur,
  editorClassName,
}: {
  tools: ToolSpec[];
  statusText: string;
  placeholder: string;
  ariaLabel: string;
  editorId: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
  onInput: () => void;
  onBlur?: () => void;
  editorClassName?: string;
}) {
  const [active, setActive] = useState<Record<string, boolean>>({});

  /** Reflects the caret's formatting onto aria-pressed, per tool probe. */
  const syncFormatState = useCallback(() => {
    try {
      const next: Record<string, boolean> = {};

      for (const tool of tools) {
        if (tool.active) {
          next[tool.key] = tool.active(document);
        }
      }

      setActive(next);
    } catch {
      // Some browsers throw with no live selection; keep the previous state.
    }
  }, [tools]);

  useEffect(() => {
    function handleSelectionChange() {
      const element = editorRef.current;
      const selection = document.getSelection();

      if (!element || !selection || selection.rangeCount === 0) {
        return;
      }

      if (!selection.anchorNode || !element.contains(selection.anchorNode)) {
        return;
      }

      syncFormatState();
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [syncFormatState, editorRef]);

  function runTool(tool: ToolSpec) {
    const element = editorRef.current;

    if (!element) {
      return;
    }

    if (tool.onRun) {
      tool.onRun(element);
      syncFormatState();
      return;
    }

    element.focus();
    document.execCommand(tool.command ?? "", false, tool.value);
    onInput();
    syncFormatState();
  }

  function handleInput() {
    onInput();
    syncFormatState();
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        aria-controls={editorId}
        className="flex flex-wrap gap-1 border-b border-border bg-surface-2 px-[10px] py-1.5"
      >
        {tools.map((tool) => (
          <button
            key={tool.key}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runTool(tool)}
            aria-pressed={tool.active ? (active[tool.key] ?? false) : undefined}
            aria-label={tool.label}
            title={tool.label}
            className={`${TOOLBAR_BUTTON_CLASS} ${tool.buttonClassName ?? ""} ${
              active[tool.key] ? "bg-accent-soft text-accent" : "bg-surface"
            }`}
          >
            {tool.content}
          </button>
        ))}

        <div className="flex-1" />

        <span
          role="status"
          aria-live="polite"
          className="self-center font-mono text-[10px] text-muted"
        >
          {statusText}
        </span>
      </div>

      {/* Focus ring rationale unchanged from Notes: :focus (not :focus-visible),
          soft inset accent ring replacing the browser's heavy outline. */}
      <div
        id={editorId}
        ref={editorRef}
        contentEditable
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-ph={placeholder}
        onInput={handleInput}
        onBlur={onBlur}
        className={
          editorClassName ??
          "min-h-[200px] flex-1 overflow-auto px-[18px] py-[18px] text-[15px] leading-[1.7] text-text outline-none focus:shadow-[inset_0_0_0_2px_var(--color-accent-soft)] min-[561px]:min-h-0"
        }
      />
    </>
  );
}
