"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import RichTextEditor, { type ToolSpec } from "@/components/editor/rich-text-editor";
import { ChevronLeftIcon, LinkIcon, PenIcon, SearchIcon } from "@/components/dashboard/icons";
import { useToast } from "@/components/dashboard/toast";
import { readApiError } from "@/lib/dashboard/read-api-error";
import {
  POST_EXCERPT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
  deriveStatus,
  slugFromTitle,
} from "@/lib/blog/posts";
import type { BlogPost, BlogPostEvent, DerivedStatus } from "@/lib/blog/types";

type SaveState = "idle" | "saving" | "saved" | "error";
type Filter = "all" | DerivedStatus;

/** The fields the editor may change; everything the PATCH body can carry. */
interface PostPatch {
  title?: string;
  content_html?: string;
  excerpt?: string;
  slug?: string;
  tags?: string[];
  published_at?: string;
}

const CONTROL_CLASS =
  "h-[34px] rounded-[9px] border border-border-2 bg-surface-2 px-[10px] text-[13px] text-text";

const FIELD_LABEL_CLASS = "block text-[11px] font-semibold uppercase tracking-wide text-muted";

const AUTOSAVE_DELAY_MS = 600;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) return "—";

  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/** ISO ↔ datetime-local (browser-local timezone). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function saveSelection(editor: HTMLDivElement): Range | null {
  const selection = document.getSelection();

  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);

  return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function restoreSelection(range: Range | null) {
  if (!range) return;

  const selection = document.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
}

const STATUS_PILL: Record<DerivedStatus, string> = {
  published: "border-green-600/40 text-green-600",
  scheduled: "border-amber-600/40 text-amber-600",
  draft: "border-border text-muted",
};

export default function BlogView({ initialPosts }: { initialPosts: BlogPost[] }) {
  const showToast = useToast();

  const [posts, setPosts] = useState<BlogPost[]>(initialPosts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [events, setEvents] = useState<BlogPostEvent[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageRangeRef = useRef<Range | null>(null);
  /** Last server-acknowledged copy per post — if_updated_at + dirty detection. */
  const baselineRef = useRef(new Map<string, BlogPost>(initialPosts.map((p) => [p.id, p])));
  const loadedPostIdRef = useRef<string | null>(null);
  const focusTitleRef = useRef(false);

  // ---- autosave (drafts only) — the Notes machinery, adapted -----------------
  const pendingRef = useRef<{ id: string; patch: PostPatch } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const appliedRevisionRef = useRef(0);
  const inFlightRef = useRef(0);
  /**
   * The in-flight autosave's full fetch chain (fetch → body parse → baseline
   * update), if any. `sendExplicit` awaits this instead of racing it with its
   * own PATCH — both would otherwise read the same stale `if_updated_at` and
   * one would 409 (see FIX 2 in the F-013 final review).
   */
  const lastSaveRef = useRef<Promise<void> | null>(null);

  const searchId = useId();
  const titleId = useId();
  const slugId = useId();
  const excerptId = useId();
  const tagsId = useId();
  const dateId = useId();

  const activePost = useMemo(
    () => posts.find((post) => post.id === selectedId) ?? null,
    [posts, selectedId]
  );

  const counts = useMemo(() => {
    const result = { all: posts.length, published: 0, draft: 0, scheduled: 0 };

    for (const post of posts) {
      result[deriveStatus(post)] += 1;
    }

    return result;
  }, [posts]);

  const visiblePosts = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return posts
      .filter((post) => filter === "all" || deriveStatus(post) === filter)
      .filter(
        (post) =>
          !needle ||
          // Title + tags only, client-side — body text is deliberately not
          // searched (the spec pins this; do not "fix" with a server call).
          `${post.title} ${post.tags.join(" ")}`.toLowerCase().includes(needle)
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [posts, filter, query]);

  const activeIsLive = activePost ? deriveStatus(activePost) === "published" : false;
  const activeIsDraftLike = activePost ? !activeIsLive : false;
  const baseline = activePost ? baselineRef.current.get(activePost.id) : undefined;

  const dirty = useMemo(() => {
    if (!activePost || !baseline) return false;

    return (
      activePost.title !== baseline.title ||
      activePost.content_html !== baseline.content_html ||
      activePost.excerpt !== baseline.excerpt ||
      activePost.slug !== baseline.slug ||
      activePost.published_at !== baseline.published_at ||
      JSON.stringify(activePost.tags) !== JSON.stringify(baseline.tags)
    );
  }, [activePost, baseline]);

  // Load the selected post's markup into the uncontrolled editor, once per post.
  const activePostId = activePost?.id ?? null;
  const activePostHtml = activePost?.content_html ?? "";

  useEffect(() => {
    const element = editorRef.current;

    if (!element) {
      loadedPostIdRef.current = null;
      return;
    }

    if (loadedPostIdRef.current === activePostId) {
      return;
    }

    loadedPostIdRef.current = activePostId;
    element.innerHTML = activePostHtml;

    if (focusTitleRef.current) {
      focusTitleRef.current = false;
      titleRef.current?.focus();
    }
  }, [activePostId, activePostHtml]);

  // Fetch the activity log when the selection changes.
  useEffect(() => {
    if (!activePostId) {
      setEvents([]);
      return;
    }

    let cancelled = false;

    void fetch(`/api/blog/posts/${activePostId}/events`)
      .then(async (response) => (response.ok ? response.json() : { events: [] }))
      .then((data: { events: BlogPostEvent[] }) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activePostId]);

  /** Applies a PATCH response: server copy becomes the new baseline. */
  const applySaved = useCallback((saved: BlogPost, keepLocalText: boolean) => {
    baselineRef.current.set(saved.id, saved);
    setPosts((previous) =>
      previous.map((post) =>
        post.id === saved.id
          ? keepLocalText
            ? {
                ...post,
                updated_at: saved.updated_at,
                reading_minutes: saved.reading_minutes,
                updated_by: saved.updated_by,
                updated_by_token_id: saved.updated_by_token_id,
                status: saved.status,
                published_at: saved.published_at,
                slug: saved.slug,
              }
            : saved
          : post
      )
    );
  }, []);

  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const pending = pendingRef.current;

    if (!pending) {
      return;
    }

    if (inFlightRef.current > 0) {
      // A save is already in flight. Starting a second one now would send
      // the same stale if_updated_at as that request — whichever lands
      // second 409s (the Publish/Update self-race this guards against more
      // generally). Re-arm the debounce instead; the in-flight request's
      // `.then` below refreshes the baseline, and `pending` is untouched so
      // the retry still has it.
      timerRef.current = setTimeout(() => flushPending(), AUTOSAVE_DELAY_MS);
      return;
    }

    pendingRef.current = null;

    const base = baselineRef.current.get(pending.id);
    const revision = revisionRef.current + 1;

    revisionRef.current = revision;
    inFlightRef.current += 1;
    setSaveState("saving");

    const savePromise = fetch(`/api/blog/posts/${pending.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pending.patch, if_updated_at: base?.updated_at }),
    })
      .then(async (response) => {
        if (response.status === 409) {
          throw new Error("This post changed — reload the page before editing further.");
        }

        if (!response.ok) {
          throw new Error(await readApiError(response, "Could not save the post."));
        }

        const saved: BlogPost = await response.json();

        if (revision < appliedRevisionRef.current) {
          return;
        }

        appliedRevisionRef.current = revision;
        // Local title/body are newer by definition (the user kept typing).
        applySaved(saved, true);
      })
      .catch((error: unknown) => {
        setSaveState("error");
        showToast(error instanceof Error ? error.message : "Could not save the post.");
      })
      .finally(() => {
        inFlightRef.current -= 1;

        // Only clear if nothing has replaced this as "the" latest save.
        if (lastSaveRef.current === savePromise) {
          lastSaveRef.current = null;
        }

        if (inFlightRef.current === 0 && !pendingRef.current) {
          setSaveState((current) => (current === "error" ? current : "saved"));
        }
      });

    lastSaveRef.current = savePromise;
  }, [applySaved, showToast]);

  const queueSave = useCallback(
    (id: string, patch: PostPatch) => {
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

  useEffect(() => () => flushPending(), [flushPending]);

  /**
   * Routes one field edit: local state always; autosave only for non-live
   * posts. LIVE POSTS NEVER AUTOSAVE — edits are held until "Update", so a
   * half-typed sentence can never go public (spec §Admin UI).
   */
  function editField(patch: PostPatch) {
    if (!activePost) return;

    setPosts((previous) =>
      previous.map((post) => (post.id === activePost.id ? { ...post, ...patch } : post))
    );

    if (!activeIsLive) {
      queueSave(activePost.id, patch);
    }
  }

  function handleEditorInput() {
    const element = editorRef.current;

    if (!element || !activePost) return;

    editField({ content_html: element.innerHTML });
  }

  async function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file || !activePost) return;

    const form = new FormData();

    form.append("file", file);
    setBusy(true);

    try {
      const response = await fetch("/api/blog/media", { method: "POST", body: form });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not upload the image."));
      }

      const media: { url: string; width?: number; height?: number } = await response.json();
      const alt = (window.prompt("Alt text (describe the image)") ?? "").trim();
      const editor = editorRef.current;

      if (!editor) return;

      editor.focus();
      restoreSelection(imageRangeRef.current);

      const dims =
        media.width && media.height ? ` width="${media.width}" height="${media.height}"` : "";

      document.execCommand(
        "insertHTML",
        false,
        `<img src="${media.url}" alt="${alt.replace(/"/g, "&quot;")}"${dims}>`
      );
      handleEditorInput();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not upload the image.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPost() {
    if (creating) return;

    flushPending();
    setCreating(true);

    try {
      // Title is required by the API; the placeholder slug keeps repeat
      // "Untitled" creations from colliding. Both are editable while draft.
      const response = await fetch("/api/blog/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled",
          slug: `draft-${crypto.randomUUID().slice(0, 8)}`,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not create the post."));
      }

      const created: BlogPost = await response.json();

      baselineRef.current.set(created.id, created);
      setPosts((previous) => [created, ...previous]);
      focusTitleRef.current = true;
      setSelectedId(created.id);
      setSaveState("saved");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not create the post.");
    } finally {
      setCreating(false);
    }
  }

  /** One explicit PATCH (Update / Publish / Unpublish / date change on live). */
  async function sendExplicit(patch: PostPatch & { status?: "draft" | "published" }) {
    if (!activePost || busy) return;

    // Cancel the pending autosave rather than flushing it: flushing here is
    // exactly the self-race this fixes — onBlur's flush (fetch 1) landing
    // alongside this PATCH (fetch 2) with the same stale if_updated_at,
    // whichever lands second 409ing. diffPatch() below reads current React
    // state directly, which already has every local edit (pending or not),
    // so nothing queued here is lost by dropping it.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    pendingRef.current = null;
    setBusy(true);

    // Wait for a save already in flight to land first — its `.then` moves
    // the baseline forward, so if_updated_at read below is fresh rather than
    // racing that request's PATCH for the same field.
    await lastSaveRef.current?.catch(() => {});

    const base = baselineRef.current.get(activePost.id);

    try {
      const response = await fetch(`/api/blog/posts/${activePost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, if_updated_at: base?.updated_at }),
      });

      if (response.status === 409) {
        throw new Error(await readApiError(response, "This post changed — reload."));
      }

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not save the post."));
      }

      const saved: BlogPost = await response.json();

      applySaved(saved, false);
      loadedPostIdRef.current = null; // reload editor markup from the server copy
      setSaveState("saved");

      return saved;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save the post.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function diffPatch(): PostPatch {
    if (!activePost) return {};

    const base = baselineRef.current.get(activePost.id);
    const patch: PostPatch = {};

    if (!base) return patch;
    if (activePost.title !== base.title) patch.title = activePost.title;
    if (activePost.content_html !== base.content_html) patch.content_html = activePost.content_html;
    if (activePost.excerpt !== base.excerpt) patch.excerpt = activePost.excerpt;
    if (activePost.slug !== base.slug) patch.slug = activePost.slug;
    if (activePost.published_at !== base.published_at && activePost.published_at)
      patch.published_at = activePost.published_at;
    if (JSON.stringify(activePost.tags) !== JSON.stringify(base.tags)) patch.tags = activePost.tags;

    return patch;
  }

  async function handlePublish() {
    if (!activePost) return;

    if (!activePost.excerpt.trim()) {
      showToast("Add an excerpt before publishing.");
      return;
    }

    const saved = await sendExplicit({
      ...diffPatch(),
      status: "published",
      ...(activePost.published_at ? { published_at: activePost.published_at } : {}),
    });

    if (saved) showToast(deriveStatus(saved) === "scheduled" ? "Post scheduled" : "Post published");
  }

  async function handleUpdateLive() {
    const saved = await sendExplicit(diffPatch());

    if (saved) showToast("Post updated");
  }

  async function handleUnpublish() {
    const saved = await sendExplicit({ status: "draft" });

    if (saved) showToast("Post unpublished");
  }

  async function handleDelete() {
    if (!activePost) return;

    const target = activePost;

    setMenuOpen(false);
    setConfirmingDelete(false);

    if (pendingRef.current?.id === target.id) {
      pendingRef.current = null;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    setPosts((previous) => previous.filter((post) => post.id !== target.id));
    setSelectedId(null);

    try {
      const response = await fetch(`/api/blog/posts/${target.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not delete the post."));
      }

      showToast("Post deleted");
    } catch (error) {
      setPosts((previous) =>
        previous.some((post) => post.id === target.id) ? previous : [...previous, target]
      );
      showToast(error instanceof Error ? error.message : "Could not delete the post.");
    }
  }

  // Blog toolbar: the Notes four plus H2, numbered list, quote, code, link.
  // The Image tool is appended by task 13.
  const tools = useMemo<ToolSpec[]>(
    () => [
      { key: "bold", label: "Bold", content: "B", command: "bold", buttonClassName: "font-bold", active: (d) => d.queryCommandState("bold") },
      { key: "italic", label: "Italic", content: "i", command: "italic", buttonClassName: "italic", active: (d) => d.queryCommandState("italic") },
      { key: "h2", label: "Heading 2", content: "H2", command: "formatBlock", value: "H2", buttonClassName: "text-xs font-bold", active: (d) => d.queryCommandValue("formatBlock").toLowerCase() === "h2" },
      { key: "h3", label: "Heading 3", content: "H3", command: "formatBlock", value: "H3", buttonClassName: "text-xs font-bold", active: (d) => d.queryCommandValue("formatBlock").toLowerCase() === "h3" },
      { key: "bullet", label: "Bullet list", content: "•", command: "insertUnorderedList", active: (d) => d.queryCommandState("insertUnorderedList") },
      { key: "numbered", label: "Numbered list", content: "1.", command: "insertOrderedList", active: (d) => d.queryCommandState("insertOrderedList") },
      { key: "quote", label: "Quote", content: "❝", command: "formatBlock", value: "BLOCKQUOTE", active: (d) => d.queryCommandValue("formatBlock").toLowerCase() === "blockquote" },
      { key: "code", label: "Code block", content: "</>", command: "formatBlock", value: "PRE", buttonClassName: "font-mono text-[10px]", active: (d) => d.queryCommandValue("formatBlock").toLowerCase() === "pre" },
      {
        key: "link",
        label: "Link",
        content: <LinkIcon size={13} />,
        // Selection must be captured BEFORE the prompt steals focus, and
        // restored before createLink — the gesture-arbitration lesson's cousin.
        onRun: (editor) => {
          const range = saveSelection(editor);
          const raw = window.prompt("Link URL (https://… , mailto:… , or /path)");

          if (!raw || !raw.trim()) return;

          const value = raw.trim();
          const url = /^(https?:|mailto:|\/)/i.test(value) ? value : `https://${value}`;

          editor.focus();
          restoreSelection(range);
          document.execCommand("createLink", false, url);
          handleEditorInput();
        },
      },
      {
        key: "image",
        label: "Image",
        content: <span className="text-[10px] font-semibold">IMG</span>,
        onRun: (editor) => {
          // Selection dies when the file dialog takes focus — capture it now.
          imageRangeRef.current = saveSelection(editor);
          imageInputRef.current?.click();
        },
      },
    ],
    // handleEditorInput is stable enough for this use: it reads refs/state via
    // closures that re-create with each render of the memo's consumers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePostId, activeIsLive]
  );

  const saveLabel =
    saveState === "saving" ? "saving…" : saveState === "error" ? "not saved" : "saved";
  const statusText = activeIsLive ? "edits held until Update" : `autosave · ${saveLabel}`;

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow min-[561px]:min-h-0 min-[561px]:flex-1">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleImagePick}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-[18px]">
        <div className="flex min-w-[160px] flex-1 items-center gap-[10px]">
          <span className="flex text-accent">
            <PenIcon />
          </span>
          <h2 className="font-heading text-[17px] font-semibold">Blog</h2>
          <span className="font-mono text-xs text-muted">{counts.all}</span>
        </div>
        <button
          type="button"
          onClick={handleNewPost}
          disabled={creating}
          className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] bg-accent px-[14px] text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          + New post
        </button>
      </div>

      <div className="grid min-h-[420px] grid-cols-[minmax(200px,260px)_minmax(0,1fr)_minmax(220px,280px)] max-[900px]:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] max-[560px]:grid-cols-1 min-[561px]:min-h-0 min-[561px]:flex-1">
        {/* ------------------------------------------------ list */}
        <div
          className={`flex min-h-0 flex-col border-r border-border max-[560px]:border-r-0 ${
            activePost ? "max-[560px]:hidden" : ""
          }`}
        >
          <div className="flex flex-wrap gap-2 border-b border-border px-[14px] py-[10px]">
            <div className="relative basis-full">
              <label htmlFor={searchId} className="sr-only">
                Search posts
              </label>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-muted"
              >
                <SearchIcon />
              </span>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title or tags…"
                className={`${CONTROL_CLASS} w-full pl-[34px]`}
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={filter === f.value}
                  className={`h-[26px] cursor-pointer rounded-[20px] border px-[10px] text-[11px] ${
                    filter === f.value
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface text-text-2"
                  }`}
                >
                  {f.label} {counts[f.value]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto min-[561px]:min-h-0">
            {visiblePosts.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted">
                No posts. Create one ↑
              </p>
            ) : (
              <ul className="list-none">
                {visiblePosts.map((post) => {
                  const active = post.id === selectedId;
                  const derived = deriveStatus(post);

                  return (
                    <li key={post.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (post.id !== selectedId) {
                            flushPending();
                            setSelectedId(post.id);
                          }
                        }}
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
                            {post.title || "Untitled"}
                          </span>
                          <span
                            className={`whitespace-nowrap rounded-[20px] border px-[7px] py-[2px] text-[10px] ${STATUS_PILL[derived]}`}
                          >
                            {derived}
                          </span>
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span className="rounded-[20px] border border-border bg-surface-2 px-[7px] py-[1px] text-[10px]">
                            {post.updated_by === "agent" ? "Agent" : "You"}
                          </span>
                          <span>{relativeTime(post.updated_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ editor */}
        <div
          className={`flex min-h-0 min-w-0 flex-col ${!activePost ? "max-[560px]:hidden" : ""}`}
        >
          {activePost ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="hidden items-center border-b border-border px-2 py-2 max-[560px]:flex">
                <button
                  type="button"
                  onClick={() => {
                    flushPending();
                    setSelectedId(null);
                  }}
                  aria-label="Back to post list"
                  className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 pr-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                >
                  <ChevronLeftIcon />
                  Posts
                </button>
              </div>

              <div className="flex items-center gap-[10px] border-b border-border px-4 py-3">
                <label htmlFor={titleId} className="sr-only">
                  Post title
                </label>
                <input
                  id={titleId}
                  ref={titleRef}
                  value={activePost.title}
                  onChange={(event) => editField({ title: event.target.value })}
                  onBlur={() => flushPending()}
                  maxLength={POST_TITLE_MAX_LENGTH}
                  placeholder="Untitled"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-[10px] font-heading text-base font-semibold text-text"
                />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Post actions"
                    className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-lg border border-border bg-transparent text-muted hover:text-text"
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-[38px] z-10 min-w-[160px] rounded-[9px] border border-border bg-surface p-1 shadow"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => (confirmingDelete ? handleDelete() : setConfirmingDelete(true))}
                        onBlur={() => {
                          setConfirmingDelete(false);
                          setMenuOpen(false);
                        }}
                        className="w-full cursor-pointer rounded-[7px] px-3 py-2 text-left text-[13px] text-red-600 hover:bg-surface-2"
                      >
                        {confirmingDelete ? "Confirm delete?" : "Delete post"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <RichTextEditor
                tools={tools}
                statusText={statusText}
                placeholder="Start writing…"
                ariaLabel="Post body"
                editorId={`${titleId}-editor`}
                editorRef={editorRef}
                onInput={handleEditorInput}
                onBlur={() => flushPending()}
              />
            </div>
          ) : (
            <p className="grid flex-1 place-items-center p-10 text-center text-sm text-muted">
              Select a post, or create a new one.
            </p>
          )}
        </div>

        {/* ------------------------------------------------ metadata panel */}
        {activePost && (
          <div className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-border p-4 max-[900px]:col-span-2 max-[900px]:border-l-0 max-[900px]:border-t max-[560px]:col-span-1">
            <div className="flex flex-wrap gap-2">
              {activeIsLive ? (
                <>
                  <button
                    type="button"
                    onClick={handleUpdateLive}
                    disabled={busy || !dirty}
                    className="inline-flex h-[34px] flex-1 cursor-pointer items-center justify-center rounded-[9px] bg-accent px-[14px] text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={handleUnpublish}
                    disabled={busy}
                    className="inline-flex h-[34px] cursor-pointer items-center rounded-[9px] border border-border px-[14px] text-[13px] font-semibold text-text disabled:opacity-60"
                  >
                    Unpublish
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => flushPending()}
                    disabled={busy}
                    className="inline-flex h-[34px] cursor-pointer items-center rounded-[9px] border border-border px-[14px] text-[13px] font-semibold text-text disabled:opacity-60"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={busy}
                    className="inline-flex h-[34px] flex-1 cursor-pointer items-center justify-center rounded-[9px] bg-accent px-[14px] text-[13px] font-semibold text-white disabled:opacity-60"
                  >
                    {activePost.published_at && new Date(activePost.published_at) > new Date()
                      ? "Schedule"
                      : "Publish"}
                  </button>
                </>
              )}
            </div>

            <div>
              <span className={FIELD_LABEL_CLASS}>Status</span>
              <p className="mt-1 text-sm font-semibold capitalize text-text">
                {deriveStatus(activePost)}
                {activeIsLive && dirty && (
                  <span className="ml-2 text-[11px] font-normal text-amber-600">
                    unsaved changes
                  </span>
                )}
              </p>
            </div>

            <div>
              <label htmlFor={dateId} className={FIELD_LABEL_CLASS}>
                Publish date {deriveStatus(activePost) === "scheduled" && "(scheduled)"}
              </label>
              <input
                id={dateId}
                type="datetime-local"
                value={isoToLocalInput(activePost.published_at)}
                onChange={(event) => {
                  const iso = localInputToIso(event.target.value);

                  if (iso) editField({ published_at: iso });
                }}
                className={`${CONTROL_CLASS} mt-1 w-full`}
              />
              <p className="mt-1 text-[11px] text-muted">
                A future date publishes as Scheduled — it goes live on its own.
              </p>
            </div>

            <div>
              <label htmlFor={slugId} className={FIELD_LABEL_CLASS}>
                URL slug
              </label>
              <div className="mt-1 flex gap-1">
                <input
                  id={slugId}
                  value={activePost.slug}
                  disabled={activeIsLive}
                  onChange={(event) => editField({ slug: event.target.value })}
                  onBlur={() => flushPending()}
                  className={`${CONTROL_CLASS} min-w-0 flex-1 font-mono text-xs disabled:opacity-60`}
                />
                {activeIsDraftLike && (
                  <button
                    type="button"
                    onClick={() => {
                      const slug = slugFromTitle(activePost.title);

                      if (slug) editField({ slug });
                    }}
                    title="Regenerate from title"
                    className="h-[34px] cursor-pointer rounded-[9px] border border-border px-2 text-[12px]"
                  >
                    ↻
                  </button>
                )}
              </div>
              {activeIsLive && (
                <p className="mt-1 text-[11px] text-muted">
                  Locked while live — renames break inbound links. Unpublish to change it.
                </p>
              )}
            </div>

            <div>
              <label htmlFor={excerptId} className={FIELD_LABEL_CLASS}>
                Excerpt{" "}
                <span className="font-mono normal-case">
                  {activePost.excerpt.length}/{POST_EXCERPT_MAX_LENGTH}
                </span>
              </label>
              <textarea
                id={excerptId}
                value={activePost.excerpt}
                maxLength={POST_EXCERPT_MAX_LENGTH}
                rows={3}
                onChange={(event) => editField({ excerpt: event.target.value })}
                onBlur={() => flushPending()}
                className="mt-1 w-full rounded-[9px] border border-border-2 bg-surface-2 px-[10px] py-2 text-[13px] text-text"
              />
              <p className="mt-1 text-[11px] text-muted">Required to publish.</p>
            </div>

            <div>
              <label htmlFor={tagsId} className={FIELD_LABEL_CLASS}>
                Tags (comma-separated, ≤ 8)
              </label>
              <input
                id={tagsId}
                defaultValue={activePost.tags.join(", ")}
                key={activePost.id}
                onBlur={(event) => {
                  const tags = event.target.value
                    .split(",")
                    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
                    .filter(Boolean);

                  editField({ tags });
                  flushPending();
                }}
                className={`${CONTROL_CLASS} mt-1 w-full`}
              />
            </div>

            <div>
              <Link
                href={`/dashboard/blog/${activePost.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-accent hover:underline"
              >
                Preview post ↗
              </Link>
            </div>

            <div>
              <span className={FIELD_LABEL_CLASS}>Activity</span>
              <ul className="mt-1 list-none text-[12px] text-text-2">
                {events.length === 0 && <li className="py-1 text-muted">No activity yet.</li>}
                {events.map((event) => (
                  <li key={event.id} className="border-b border-border py-[6px] last:border-b-0">
                    <span className="font-semibold">
                      {event.actor === "agent" ? "Agent" : "You"}
                    </span>{" "}
                    {event.action}
                    {event.summary && <span className="text-muted"> — {event.summary}</span>}
                    <span className="block text-[11px] text-muted">
                      {relativeTime(event.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
