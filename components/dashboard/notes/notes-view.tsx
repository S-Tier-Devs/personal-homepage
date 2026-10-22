"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ChevronLeftIcon, NoteIcon, SearchIcon, TrashIcon } from "@/components/dashboard/icons";
import { useToast } from "@/components/dashboard/toast";
import { useWorkspace } from "@/components/dashboard/workspace-context";
import RichTextEditor, { type ToolSpec } from "@/components/editor/rich-text-editor";
import { resolveNotePane } from "@/lib/dashboard/resolve-note-pane";
import type { Category, NoteItem } from "@/lib/dashboard/types";
import { NOTE_TITLE_MAX_LENGTH, noteHtmlToText } from "@/lib/sanitize";

type SortKey = "recent" | "alpha";

/** Real request state, never a timer — the indicator has to be honest. */
type SaveState = "idle" | "saving" | "saved" | "error";

/** The subset of a note the editor is allowed to autosave. */
interface NotePatch {
  title?: string;
  content_html?: string;
  category_id?: string;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "alpha", label: "A–Z" },
];

const CONTROL_CLASS =
  "h-[34px] rounded-[9px] border border-border-2 bg-surface-2 px-[10px] text-[13px] text-text";

/** Matches the design's editor autosave delay. */
const AUTOSAVE_DELAY_MS = 300;

/**
 * The Fetch spec's ceiling on `keepalive` request bodies is 64 KiB, shared
 * across all in-flight keepalive requests; this leaves headroom under it.
 */
const KEEPALIVE_MAX_BYTES = 56 * 1024;

/**
 * Pulls a human-readable message off a failed API response. Dashboard routes
 * answer with `{ error, message }`; `requireAdminAuth` answers with `{ error }`
 * alone, so both shapes are handled before falling back.
 */
async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === "object" && body !== null) {
      const { message, error } = body as { message?: unknown; error?: unknown };

      if (typeof message === "string" && message) {
        return message;
      }

      if (typeof error === "string" && error) {
        return error;
      }
    }
  } catch {
    // Non-JSON error responses fall through to the generic message.
  }

  return fallback;
}

const NOTE_TOOLS: ToolSpec[] = [
  {
    key: "bold",
    label: "Bold",
    content: "B",
    command: "bold",
    buttonClassName: "font-bold",
    active: (doc) => doc.queryCommandState("bold"),
  },
  {
    key: "italic",
    label: "Italic",
    content: "i",
    command: "italic",
    buttonClassName: "italic",
    active: (doc) => doc.queryCommandState("italic"),
  },
  {
    key: "bullet",
    label: "Bullet list",
    content: "•",
    command: "insertUnorderedList",
    active: (doc) => doc.queryCommandState("insertUnorderedList"),
  },
  {
    key: "heading",
    label: "Heading",
    content: "H",
    command: "formatBlock",
    value: "H3",
    buttonClassName: "text-xs font-bold",
    active: (doc) => doc.queryCommandValue("formatBlock").toLowerCase() === "h3",
  },
];

export default function NotesView({
  initialNotes,
  categories,
}: {
  initialNotes: NoteItem[];
  categories: Category[];
}) {
  const { workspace } = useWorkspace();
  const showToast = useToast();

  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Live row buttons keyed by note id, for restoring focus after "← Notes". */
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  /** The note id whose row should regain focus when the editor closes. */
  const refocusRowRef = useRef<string | null>(null);

  // ---- autosave bookkeeping -------------------------------------------------
  // All refs, because none of it should cause a render: the only visible part
  // is `saveState`.
  /** The coalesced patch waiting for the debounce to elapse. */
  const pendingRef = useRef<{ id: string; patch: NotePatch } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic id stamped on every request as it is sent. */
  const revisionRef = useRef(0);
  /** The highest revision whose response has been applied. */
  const appliedRevisionRef = useRef(0);
  const inFlightRef = useRef(0);

  /** Which note's markup is currently in the editor DOM. */
  const loadedNoteIdRef = useRef<string | null>(null);
  /** Set when a just-created note should open with the title field focused. */
  const focusTitleRef = useRef(false);

  const searchId = useId();
  const filterId = useId();
  const sortId = useId();
  const titleId = useId();
  const noteCategoryId = useId();

  // Both workspaces are already in memory, so switching is a re-filter — no refetch.
  const workspaceCategories = useMemo(
    () =>
      categories
        .filter((category) => category.ctx === workspace && category.kind === "note")
        .sort((a, b) => a.sort_order - b.sort_order),
    [categories, workspace]
  );

  const categoryNames = useMemo(() => {
    const names = new Map<string, string>();

    for (const category of categories) {
      names.set(category.id, category.name);
    }

    return names;
  }, [categories]);

  /** Plain-text bodies, shared by the row previews and the search filter. */
  const noteText = useMemo(() => {
    const texts = new Map<string, string>();

    for (const note of notes) {
      texts.set(note.id, noteHtmlToText(note.content_html));
    }

    return texts;
  }, [notes]);

  // Derived rather than reset in an effect: a category id from the other
  // workspace simply stops being a valid choice when the workspace changes.
  const activeFilter = workspaceCategories.some((category) => category.id === categoryFilter)
    ? categoryFilter
    : "all";
  const defaultCategoryId = workspaceCategories[0]?.id ?? "";

  // Same idea for the selection: a note belonging to the other workspace is
  // simply not the active note any more.
  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedId && note.ctx === workspace) ?? null,
    [notes, selectedId, workspace]
  );

  const pane = resolveNotePane(activeNote);

  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return notes
      .filter((note) => note.ctx === workspace)
      .filter(
        (note) =>
          !needle ||
          `${note.title} ${noteText.get(note.id) ?? ""}`.toLowerCase().includes(needle)
      )
      .filter((note) => activeFilter === "all" || note.category_id === activeFilter)
      .sort((a, b) => {
        if (sort === "alpha") {
          return (a.title || "").localeCompare(b.title || "");
        }

        // "Recent" for notes means most recently *edited*, not created.
        return b.updated_at.localeCompare(a.updated_at);
      });
  }, [notes, workspace, query, noteText, activeFilter, sort]);

  const activeNoteId = activeNote?.id ?? null;
  const activeNoteHtml = activeNote?.content_html ?? "";

  /**
   * Loads the active note into the editor. This is DOM synchronisation, not
   * state synchronisation: the editor is deliberately uncontrolled, so its
   * markup is written exactly once per note. Writing it on every render — or on
   * every keystroke — would move the caret to the start of the document as the
   * user types.
   *
   * `activeNoteHtml` is in the dependency list to satisfy the exhaustive-deps
   * rule; the id guard is what actually decides whether anything is written.
   */
  useEffect(() => {
    const element = editorRef.current;

    if (!element) {
      // The editor is unmounted (no active note), so nothing is loaded.
      loadedNoteIdRef.current = null;

      // Returning from the editor on mobile ("← Notes") unmounts the focused
      // back button, which would drop focus to <body>. Restore it to the row
      // of the note we were viewing so keyboard and screen-reader users land
      // where they left off. The list is in the DOM the whole time (only
      // CSS-hidden in editor view), so its row is focusable again the moment
      // this runs. Falls back to the search box if that row is no longer
      // rendered — e.g. an edit made the note stop matching an active filter.
      const refocusId = refocusRowRef.current;

      if (refocusId) {
        refocusRowRef.current = null;
        (rowRefs.current.get(refocusId) ?? searchRef.current)?.focus();
      }

      return;
    }

    if (loadedNoteIdRef.current === activeNoteId) {
      return;
    }

    loadedNoteIdRef.current = activeNoteId;
    element.innerHTML = activeNoteHtml;

    if (focusTitleRef.current) {
      focusTitleRef.current = false;
      // A new note opens with the title focused so the first keystroke names
      // it; Enter then hands off to the body (see handleTitleKeyDown).
      titleRef.current?.focus();
    }
  }, [activeNoteId, activeNoteHtml]);

  /**
   * Sends whatever is queued right now. Called by the debounce timer, and
   * directly whenever the edit is about to become unreachable — blur, note
   * switch, unmount, page hide.
   */
  const flushPending = useCallback(
    (options?: { keepalive?: boolean }) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const pending = pendingRef.current;

      if (!pending) {
        return;
      }

      pendingRef.current = null;

      const revision = revisionRef.current + 1;
      revisionRef.current = revision;
      inFlightRef.current += 1;
      setSaveState("saving");

      const body = JSON.stringify(pending.patch);

      // `keepalive` lets the request outlive the document, which is the whole
      // point of the `pagehide` flush — but the Fetch spec caps keepalive
      // bodies at 64 KiB and rejects anything larger outright. For a long note
      // an ordinary request that *might* be cancelled beats one that is
      // guaranteed to fail.
      const keepalive =
        (options?.keepalive ?? false) && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES;

      void fetch(`/api/notes/${pending.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await readApiError(response, "Could not save the note."));
          }

          const saved: NoteItem = await response.json();

          // Out-of-order guard: a slow earlier save must never land on top of a
          // later one's result.
          if (revision < appliedRevisionRef.current) {
            return;
          }

          appliedRevisionRef.current = revision;

          // Only `updated_at` is taken from the response — it is trigger-owned
          // and drives the "Recent" sort. Title and body in state are newer by
          // definition (the user has kept typing since the request left), so
          // copying the server's copy back would undo those keystrokes. The
          // server's sanitized markup is what a later page load will show.
          setNotes((previous) =>
            previous.map((note) =>
              note.id === saved.id ? { ...note, updated_at: saved.updated_at } : note
            )
          );
        })
        .catch((error: unknown) => {
          setSaveState("error");
          showToast(error instanceof Error ? error.message : "Could not save the note.");
        })
        .finally(() => {
          inFlightRef.current -= 1;

          if (inFlightRef.current === 0 && !pendingRef.current) {
            // A failure stays visible until the next save actually starts.
            setSaveState((current) => (current === "error" ? current : "saved"));
          }
        });
    },
    [showToast]
  );

  /** Coalesces an edit into the pending patch and restarts the debounce. */
  const queueSave = useCallback(
    (id: string, patch: NotePatch) => {
      // A queued patch belongs to exactly one row; switching notes sends it
      // before it can be merged into the next note's save.
      if (pendingRef.current && pendingRef.current.id !== id) {
        flushPending();
      }

      pendingRef.current = { id, patch: { ...(pendingRef.current?.patch ?? {}), ...patch } };
      setSaveState("saving");

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => flushPending(), AUTOSAVE_DELAY_MS);
    },
    [flushPending]
  );

  // A closed tab or a hard navigation must not lose the last 300ms of typing.
  useEffect(() => {
    function handlePageHide() {
      flushPending({ keepalive: true });
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [flushPending]);

  // Client-side navigation away from the section unmounts this view without
  // firing `pagehide`, so flush there too.
  useEffect(() => () => flushPending({ keepalive: true }), [flushPending]);

  function handleEditorInput() {
    const element = editorRef.current;

    if (!element || !activeNote) {
      return;
    }

    const html = element.innerHTML;

    // Local state holds the browser's own markup so previews and search stay in
    // step with what is on screen. The stored copy is the sanitized one — every
    // write goes through `sanitizeNoteHtml` on the server.
    setNotes((previous) =>
      previous.map((note) =>
        note.id === activeNote.id ? { ...note, content_html: html } : note
      )
    );
    queueSave(activeNote.id, { content_html: html });
  }

  function handleTitleChange(value: string) {
    if (!activeNote) {
      return;
    }

    setNotes((previous) =>
      previous.map((note) => (note.id === activeNote.id ? { ...note, title: value } : note))
    );
    queueSave(activeNote.id, { title: value });
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Enter in the single-line title hands off to the body, matching the
    // top-to-bottom flow of filling in a note. The isComposing guard keeps a
    // mid-character Enter (IME input) from being hijacked.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      editorRef.current?.focus();
    }
  }

  function handleCategoryChange(value: string) {
    if (!activeNote) {
      return;
    }

    setNotes((previous) =>
      previous.map((note) =>
        note.id === activeNote.id ? { ...note, category_id: value } : note
      )
    );
    queueSave(activeNote.id, { category_id: value });
    // Not a keystroke — no reason to make the user wait out the debounce.
    flushPending();
  }

  function handleOpenNote(id: string) {
    if (id === selectedId) {
      return;
    }

    // The outgoing note's edit is sent before the editor is repointed.
    flushPending();
    setSelectedId(id);
  }

  function handleBack() {
    // Remember which row to refocus once the editor closes (see the load
    // effect); capture it before clearing the selection.
    refocusRowRef.current = activeNoteId;
    // Save the outgoing edit before returning to the list, mirroring handleOpenNote.
    flushPending();
    setSelectedId(null);
  }

  async function handleNewNote() {
    if (creating || !defaultCategoryId) {
      return;
    }

    flushPending();
    setCreating(true);

    try {
      // Created empty and up front: the row must have a server id before the
      // first autosave, otherwise the debounced PATCH has nothing to address.
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctx: workspace, category_id: defaultCategoryId }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not create the note."));
      }

      const created: NoteItem = await response.json();

      setNotes((previous) => [created, ...previous]);
      focusTitleRef.current = true;
      setSelectedId(created.id);
      setSaveState("saved");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not create the note.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(target: NoteItem) {
    // Drop rather than flush the queued patch: a PATCH racing its own DELETE
    // would come back 404 and toast a failure for work that succeeded.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (pendingRef.current?.id === target.id) {
      pendingRef.current = null;
      setSaveState("idle");
    } else {
      flushPending();
    }

    setNotes((previous) => previous.filter((note) => note.id !== target.id));

    if (selectedId === target.id) {
      setSelectedId(null);
    }

    try {
      const response = await fetch(`/api/notes/${target.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not delete the note."));
      }

      showToast("Note deleted");
    } catch (error) {
      // Row order is derived at render time, so re-appending restores the note
      // to exactly the position it came from.
      setNotes((previous) =>
        previous.some((note) => note.id === target.id) ? previous : [...previous, target]
      );
      showToast(error instanceof Error ? error.message : "Could not delete the note.");
    }
  }

  const saveLabel =
    saveState === "saving" ? "saving…" : saveState === "error" ? "not saved" : "saved";

  return (
    <section
      data-pane={pane}
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow min-[561px]:min-h-0 min-[561px]:flex-1"
    >
      <div
        data-notes-header=""
        className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-[18px]"
      >
        <div className="flex min-w-[160px] flex-1 items-center gap-[10px]">
          <span className="flex text-accent">
            <NoteIcon />
          </span>
          <h2 className="font-heading text-[17px] font-semibold">Notes</h2>
          <span className="font-mono text-xs text-muted">{visibleNotes.length}</span>
        </div>
        <button
          type="button"
          onClick={handleNewNote}
          disabled={creating || !defaultCategoryId}
          // A note needs a note-kind category in this workspace to point its
          // non-null foreign key at; without one the button cannot work, so say why.
          title={defaultCategoryId ? undefined : "Add a note category for this workspace first"}
          className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] bg-accent px-[14px] text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          + New note
        </button>
      </div>

      <div className="grid min-h-[360px] grid-cols-[minmax(180px,240px)_1fr] max-[560px]:grid-cols-1 min-[561px]:min-h-0 min-[561px]:flex-1 min-[561px]:grid-rows-1">
        <div
          data-notes-list=""
          className="flex flex-col border-r border-border max-[560px]:border-r-0 max-[560px]:border-b min-[561px]:min-h-0"
        >
          <div className="flex flex-wrap gap-2 border-b border-border px-[14px] py-[10px]">
            <div className="relative basis-full">
              <label htmlFor={searchId} className="sr-only">
                Search notes
              </label>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-muted"
              >
                <SearchIcon />
              </span>
              <input
                id={searchId}
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search…"
                className={`${CONTROL_CLASS} w-full pl-[34px]`}
              />
            </div>

            <label htmlFor={filterId} className="sr-only">
              Filter notes by category
            </label>
            <select
              id={filterId}
              value={activeFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className={`${CONTROL_CLASS} min-w-0 flex-1`}
            >
              <option value="all">All</option>
              {workspaceCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <label htmlFor={sortId} className="sr-only">
              Sort notes
            </label>
            <select
              id={sortId}
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className={`${CONTROL_CLASS} min-w-0 flex-1`}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[460px] flex-1 overflow-auto min-[561px]:max-h-none min-[561px]:min-h-0">
            {visibleNotes.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted">
                No notes. Create one ↑
              </p>
            ) : (
              <ul className="list-none">
                {visibleNotes.map((note) => {
                  const active = note.id === activeNoteId;

                  return (
                    <li key={note.id}>
                      <button
                        ref={(el) => {
                          if (el) {
                            rowRefs.current.set(note.id, el);
                          } else {
                            rowRefs.current.delete(note.id);
                          }
                        }}
                        type="button"
                        onClick={() => handleOpenNote(note.id)}
                        aria-current={active ? "true" : undefined}
                        className={[
                          "w-full cursor-pointer border-b border-l-[3px] border-b-border px-[14px] py-3 text-left",
                          active
                            ? "border-l-accent bg-accent-soft"
                            : "border-l-transparent bg-transparent hover:bg-surface-2",
                        ].join(" ")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-text">
                            {note.title || "Untitled"}
                          </span>
                          <span className="whitespace-nowrap rounded-[20px] border border-border bg-surface-2 px-[7px] py-[2px] text-[10px] text-text-2">
                            {categoryNames.get(note.category_id) ?? "Uncategorized"}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted">
                          {noteText.get(note.id) || "Empty note"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div data-notes-editor="" className="flex min-w-0 flex-col min-[561px]:min-h-0">
          {activeNote ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                data-notes-back=""
                className="hidden items-center border-b border-border px-2 py-2"
              >
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label="Back to notes list"
                  className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 pr-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                >
                  <ChevronLeftIcon />
                  Notes
                </button>
              </div>

              <div className="flex items-center gap-[10px] border-b border-border px-4 py-3">
                <label htmlFor={titleId} className="sr-only">
                  Note title
                </label>
                <input
                  id={titleId}
                  ref={titleRef}
                  value={activeNote.title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={() => flushPending()}
                  maxLength={NOTE_TITLE_MAX_LENGTH}
                  placeholder="Untitled"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-[10px] font-heading text-base font-semibold text-text"
                />

                <label htmlFor={noteCategoryId} className="sr-only">
                  Note category
                </label>
                <select
                  id={noteCategoryId}
                  value={activeNote.category_id}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                  className={`${CONTROL_CLASS} rounded-lg`}
                >
                  {workspaceCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleDelete(activeNote)}
                  aria-label={`Delete ${activeNote.title || "Untitled"}`}
                  title="Delete note"
                  className="grid h-[34px] w-[34px] flex-none cursor-pointer place-items-center rounded-lg border border-border bg-transparent text-muted hover:text-text"
                >
                  <TrashIcon />
                </button>
              </div>

              <RichTextEditor
                tools={NOTE_TOOLS}
                statusText={`spellcheck on · ${saveLabel}`}
                placeholder="Start writing… spellcheck is on."
                ariaLabel="Note body"
                editorId={`${titleId}-editor`}
                editorRef={editorRef}
                onInput={handleEditorInput}
                onBlur={() => flushPending()}
              />
            </div>
          ) : (
            <p className="grid flex-1 place-items-center p-10 text-center text-sm text-muted">
              Select a note, or create a new one.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
