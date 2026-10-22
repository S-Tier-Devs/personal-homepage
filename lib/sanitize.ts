/**
 * Server-side HTML allowlist for note bodies.
 *
 * Note content is authored in a `contenteditable`, which means the browser —
 * and anything the user pastes into it — decides what markup arrives. That is
 * hostile input: it may be unbalanced, may contain comments, `<SCRIPT>` in any
 * casing, event-handler attributes, or a `>` inside a quoted attribute value.
 * A regex that assumes well-formed markup would be defeated by all of those, so
 * this module tokenizes the input with a small state machine instead and
 * *re-serializes* only what it recognises. Anything it does not understand
 * cannot survive, because nothing is ever copied through verbatim.
 *
 * The rules:
 *   - Only the tags named by the active profile (`NOTE_PROFILE` here) are
 *     emitted, each with whatever attributes its `TagRule` allows — zero, for
 *     notes: no `style`, `class`, `href`, `src`, and no `on*` handlers.
 *   - Any other tag is dropped but its text content is kept, so pasting from a
 *     word processor loses the chrome and keeps the words.
 *   - `<script>` and `<style>` are the exception: their *contents* are
 *     discarded too, since that text is code, not prose.
 *   - Output is always balanced: unclosed tags are closed at the end, and stray
 *     end tags are ignored.
 *
 * This runs on the server, before the row is written. The client never gets to
 * be the only sanitizer.
 */

/** Allowed tags that never have children and are never pushed onto the stack. */
const VOID_TAGS = new Set(["br", "img", "hr"]);

/** Tags whose text content is code and must be thrown away with the tag. */
const RAW_TEXT_TAGS = new Set(["script", "style"]);

/**
 * Caps on what a single note may store. These are checked against the *raw*
 * request values before sanitizing, so a paste bomb is rejected rather than
 * parsed, and cannot be used to fill the table.
 */
export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 100_000;

/**
 * A character reference that is already well-formed. Sticky, so it can be
 * tested at an exact offset without slicing the string.
 *
 * Ampersands that begin one of these are passed through untouched; every other
 * ampersand becomes `&amp;`. Escaping *all* of them would make sanitizing
 * non-idempotent — each autosave round trip would turn `&amp;` into
 * `&amp;amp;` and the note would rot one save at a time.
 */
const ENTITY_PATTERN = /&(?:#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/y;

const WHITESPACE_PATTERN = /\s/;
const TAG_NAME_PATTERN = /[a-zA-Z0-9]/;

function isAsciiLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/**
 * Escapes a run of text for re-insertion into HTML. `<` and `>` always become
 * entities; `&` only when it does not already start a character reference.
 */
function escapeText(value: string): string {
  return value.replace(/[<>&]/g, (ch, offset: number) => {
    if (ch === "<") {
      return "&lt;";
    }

    if (ch === ">") {
      return "&gt;";
    }

    ENTITY_PATTERN.lastIndex = offset;

    return ENTITY_PATTERN.test(value) ? "&" : "&amp;";
  });
}

interface TagRule {
  /**
   * Serializes this tag's allowed attributes from the collected raw ones.
   * Returns the attribute string to emit (may be ""), or null to drop the
   * ELEMENT entirely. null is only legal for void tags (img) — a non-void
   * rule must never return it, because there is no skip-to-close pass.
   */
  attributes?: (attrs: ReadonlyMap<string, string>) => string | null;
}

interface SanitizeProfile {
  tags: ReadonlyMap<string, TagRule>;
}

/**
 * Minimal named-entity map for attribute-value decoding. Anything not listed
 * stays literal — and because emitted attribute values re-escape every "&",
 * an undecoded entity is inert in the output (the browser sees "&amp;colon;",
 * not ":"). Numeric references are decoded in full.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function codePointOrFallback(cp: number, fallback: string): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return fallback;
  }

  return String.fromCodePoint(cp);
}

/**
 * Decodes character references the way a browser would before IT reads an
 * attribute value — the step that defeats entity-obfuscated schemes like
 * `&#106;avascript:`. Validation always runs on the DECODED value.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (whole, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec !== undefined) return codePointOrFallback(parseInt(dec, 10), whole);
      if (hex !== undefined) return codePointOrFallback(parseInt(hex, 16), whole);
      return NAMED_ENTITIES[named as string] ?? whole;
    }
  );
}

/** Escapes a DECODED attribute value for double-quoted emission. */
function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;"
  );
}

type TagScanState =
  | "beforeAttr"
  | "attrName"
  | "afterAttrName"
  | "beforeValue"
  | "quotedValue"
  | "unquotedValue";

interface ScannedTag {
  end: number;
  /** Lowercased name → decoded value ("" for valueless attrs). First wins. */
  attrs: Map<string, string>;
}

/**
 * Finds where a tag ends, starting just past its name, collecting attributes
 * on the way. Same quote-tracking state machine as before — the piece a naive
 * /<[^>]*>/ gets wrong — now also recording name/value pairs so profiles can
 * allowlist attributes. Unterminated tags consume to end-of-input, unchanged.
 *
 * This is the piece a naive `/<[^>]*>/` gets wrong: inside a quoted attribute
 * value a `>` is an ordinary character, so `<div title="a>b">` is one tag, not
 * a tag plus the text `b">`. The state machine below tracks quoting the way an
 * HTML tokenizer does, so the attribute-smuggling trick has nothing to smuggle.
 */
function scanTag(html: string, from: number): ScannedTag {
  const attrs = new Map<string, string>();
  let state: TagScanState = "beforeAttr";
  let quote = "";
  let nameStart = -1;
  let name = "";
  let valueStart = -1;
  let i = from;

  function commit(value: string) {
    if (name && !attrs.has(name)) {
      attrs.set(name, decodeEntities(value));
    }

    name = "";
  }

  while (i < html.length) {
    const ch = html[i];

    switch (state) {
      case "beforeAttr":
        if (ch === ">") return { end: i + 1, attrs };
        if (WHITESPACE_PATTERN.test(ch) || ch === "/") {
          i += 1;
          break;
        }
        nameStart = i;
        state = "attrName";
        break;

      case "attrName":
        if (ch === ">") {
          name = html.slice(nameStart, i).toLowerCase();
          commit("");
          return { end: i + 1, attrs };
        }
        if (ch === "=") {
          name = html.slice(nameStart, i).toLowerCase();
          state = "beforeValue";
          i += 1;
          break;
        }
        if (WHITESPACE_PATTERN.test(ch)) {
          name = html.slice(nameStart, i).toLowerCase();
          state = "afterAttrName";
          i += 1;
          break;
        }
        i += 1;
        break;

      case "afterAttrName":
        if (ch === ">") {
          commit("");
          return { end: i + 1, attrs };
        }
        if (WHITESPACE_PATTERN.test(ch)) {
          i += 1;
          break;
        }
        if (ch === "=") {
          state = "beforeValue";
          i += 1;
          break;
        }
        commit("");
        nameStart = i;
        state = "attrName";
        break;

      case "beforeValue":
        if (ch === ">") {
          commit("");
          return { end: i + 1, attrs };
        }
        if (WHITESPACE_PATTERN.test(ch)) {
          i += 1;
          break;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          valueStart = i + 1;
          state = "quotedValue";
          i += 1;
          break;
        }
        valueStart = i;
        state = "unquotedValue";
        break;

      case "quotedValue":
        if (ch === quote) {
          commit(html.slice(valueStart, i));
          state = "beforeAttr";
        }
        i += 1;
        break;

      case "unquotedValue":
        if (ch === ">") {
          commit(html.slice(valueStart, i));
          return { end: i + 1, attrs };
        }
        if (WHITESPACE_PATTERN.test(ch)) {
          commit(html.slice(valueStart, i));
          state = "beforeAttr";
          i += 1;
          break;
        }
        i += 1;
        break;
    }
  }

  // Unterminated tag: consumed and dropped, as before. In-flight attr discarded.
  return { end: html.length, attrs };
}

function scanTagEnd(html: string, from: number): number {
  return scanTag(html, from).end;
}

/**
 * Skips the raw-text content of a `<script>`/`<style>` element and its closing
 * tag. Inside these elements `<` is not markup, so the only thing that ends
 * them is a matching end tag — matched case-insensitively via `lowerHtml`.
 */
function skipRawText(html: string, lowerHtml: string, from: number, name: string): number {
  const closing = `</${name}`;
  let search = from;

  for (;;) {
    const index = lowerHtml.indexOf(closing, search);

    if (index === -1) {
      return html.length;
    }

    const after = html[index + closing.length];

    // `</scriptx>` does not close a script element; `</script >` does.
    if (after === undefined || after === ">" || after === "/" || WHITESPACE_PATTERN.test(after)) {
      return scanTagEnd(html, index + closing.length);
    }

    search = index + closing.length;
  }
}

/**
 * Returns a safe, balanced subset of `input` containing only the tags present
 * in `profile`, with attributes serialized per each tag's rule (none, by
 * default).
 */
function sanitizeHtml(input: string, profile: SanitizeProfile): string {
  if (typeof input !== "string" || input === "") {
    return "";
  }

  const html = input;
  const lowerHtml = html.toLowerCase();
  const out: string[] = [];
  /** Allowed, still-open elements, innermost last. */
  const open: string[] = [];
  let pendingText = "";
  let i = 0;

  function flushText() {
    if (pendingText) {
      out.push(escapeText(pendingText));
      pendingText = "";
    }
  }

  while (i < html.length) {
    if (html[i] !== "<") {
      pendingText += html[i];
      i += 1;
      continue;
    }

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    // Doctypes, CDATA and processing instructions carry no content we want.
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const isEndTag = html[i + 1] === "/";
    const nameStart = isEndTag ? i + 2 : i + 1;

    if (!isAsciiLetter(html[nameStart] ?? "")) {
      // A `<` that does not begin a tag is literal text, as in a browser. It is
      // escaped on the way out, so it cannot become a tag later.
      pendingText += html[i];
      i += 1;
      continue;
    }

    let nameEnd = nameStart;

    while (nameEnd < html.length && TAG_NAME_PATTERN.test(html[nameEnd])) {
      nameEnd += 1;
    }

    const name = html.slice(nameStart, nameEnd).toLowerCase();

    if (RAW_TEXT_TAGS.has(name)) {
      const tagEnd = scanTagEnd(html, nameEnd);

      // A stray `</script>` with no opener is simply dropped.
      i = isEndTag ? tagEnd : skipRawText(html, lowerHtml, tagEnd, name);
      continue;
    }

    const rule = profile.tags.get(name);

    if (!rule) {
      // Drop the tag, keep whatever it wrapped.
      i = scanTagEnd(html, nameEnd);
      continue;
    }

    flushText();

    if (isEndTag) {
      const tagEnd = scanTagEnd(html, nameEnd);
      const index = open.lastIndexOf(name);

      // Close everything opened inside the element too, so `<p><b>x</p>` still
      // produces balanced output. An end tag with no opener is ignored.
      if (index !== -1) {
        for (let k = open.length - 1; k >= index; k -= 1) {
          out.push(`</${open[k]}>`);
        }

        open.length = index;
      }

      i = tagEnd;
    } else {
      const scanned = scanTag(html, nameEnd);
      const attrText = rule.attributes ? rule.attributes(scanned.attrs) : "";

      if (attrText === null) {
        // Element dropped by its rule (img off-origin). Only void tags may do
        // this — see TagRule.attributes.
        i = scanned.end;
        continue;
      }

      if (VOID_TAGS.has(name)) {
        out.push(`<${name}${attrText}>`);
      } else {
        out.push(`<${name}${attrText}>`);
        open.push(name);
      }

      i = scanned.end;
    }
  }

  flushText();

  for (let k = open.length - 1; k >= 0; k -= 1) {
    out.push(`</${open[k]}>`);
  }

  return out.join("");
}

const NOTE_RULE: TagRule = {};

const NOTE_PROFILE: SanitizeProfile = {
  tags: new Map(
    ["b", "strong", "i", "em", "ul", "li", "h3", "p", "br", "div"].map((t) => [
      t,
      NOTE_RULE,
    ])
  ),
};

export function sanitizeNoteHtml(input: string): string {
  return sanitizeHtml(input, NOTE_PROFILE);
}

/** Caps checked by the blog routes against RAW request values. */
export const POST_CONTENT_MAX_LENGTH = 200_000;

/**
 * Validates an href by RESOLVING it (never prefix-matching — see the
 * open-redirect lesson in AGENTS.md): a root-relative candidate is resolved
 * against a fixed throwaway origin, and anything that changes that origin
 * (//evil.com, /\evil.com) is rejected. Absolute URLs are allowlisted by
 * parsed protocol.
 */
function sanitizeHref(raw: string): { value: string; external: boolean } | null {
  const value = raw.trim();

  if (!value) return null;

  if (/^(https?|mailto):/i.test(value)) {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    if (parsed.protocol !== "mailto:" && !parsed.hostname) return null;

    return { value: parsed.toString(), external: true };
  }

  if (!value.startsWith("/")) return null;

  const base = "https://pb-internal.invalid";
  let resolved: URL;

  try {
    resolved = new URL(value, base);
  } catch {
    return null;
  }

  if (resolved.origin !== base) return null;

  const emitted = resolved.pathname + resolved.search + resolved.hash;

  // The serialized form must itself resolve back to base: "/..//evil.com"
  // normalizes to the protocol-relative "//evil.com", which does not — the
  // parsed `resolved` object looked safe, but re-serializing it produced a
  // different, unsafe string. Round-trip the EMITTED value, not the parsed
  // one.
  if (new URL(emitted, base).origin !== base) return null;

  return { value: emitted, external: false };
}

const DIMENSION_PATTERN = /^\d{1,5}$/;
const IMG_ALT_MAX_LENGTH = 300;

function buildPostProfile(mediaOrigin: string | null): SanitizeProfile {
  let cdnOrigin: string | null = null;

  if (mediaOrigin) {
    try {
      cdnOrigin = new URL(mediaOrigin).origin;
    } catch {
      cdnOrigin = null;
    }
  }

  const anchorRule: TagRule = {
    attributes(attrs) {
      const href = attrs.has("href") ? sanitizeHref(attrs.get("href") ?? "") : null;
      // An <a> with a rejected href survives as inert text — attribute-level
      // drop, element kept, exactly as the spec words it.
      let out = href ? ` href="${escapeAttr(href.value)}"` : "";

      out += ' rel="noopener noreferrer"';

      if (href?.external) out += ' target="_blank"';

      return out;
    },
  };

  const imgRule: TagRule = {
    attributes(attrs) {
      const src = attrs.get("src")?.trim() ?? "";
      let parsed: URL;

      try {
        parsed = new URL(src);
      } catch {
        return null; // drop the element — img without a CDN src is never emitted
      }

      if (!cdnOrigin || parsed.origin !== cdnOrigin) return null;

      let out = ` src="${escapeAttr(parsed.toString())}"`;
      const alt = attrs.get("alt");

      if (alt !== undefined) {
        out += ` alt="${escapeAttr(alt.slice(0, IMG_ALT_MAX_LENGTH))}"`;
      }

      for (const dim of ["width", "height"] as const) {
        const rawDim = attrs.get(dim);

        if (rawDim === undefined || !DIMENSION_PATTERN.test(rawDim)) continue;

        const n = parseInt(rawDim, 10);

        if (n >= 1 && n <= 10000) out += ` ${dim}="${n}"`;
      }

      return out;
    },
  };

  const plain: TagRule = {};
  const tags = new Map<string, TagRule>();

  for (const t of [
    "p", "br", "strong", "b", "em", "i", "h2", "h3", "ul", "ol", "li",
    "blockquote", "pre", "code", "figure", "figcaption", "hr",
    // contenteditable emits <div> per line (see RichTextEditor's mount
    // effect); dropping it as an unknown tag merges adjacent lines' text
    // together with no separator, not just losing formatting.
    "div",
  ]) {
    tags.set(t, plain);
  }

  tags.set("a", anchorRule);
  tags.set("img", imgRule);

  return { tags };
}

/**
 * Post-body sanitiser (F-013). Same tokenizer and guarantees as
 * sanitizeNoteHtml, plus an attribute allowlist: a[href] (resolved, never
 * prefix-matched), img[src] pinned to the media CDN origin, img[alt] ≤300,
 * img[width|height] integers 1–10000 (the no-layout-shift carriers — do not
 * strip them). Idempotent. mediaOrigin null ⇒ every <img> is dropped.
 */
export function sanitizePostHtml(
  input: string,
  options: { mediaOrigin: string | null }
): string {
  return sanitizeHtml(input, buildPostProfile(options.mediaOrigin));
}

/**
 * The plain-text rendering of sanitized note HTML — used for list previews and
 * search. Shared with the client, which is why it lives here rather than in the
 * view: both sides must agree on what a note "says".
 *
 * The naive tag-stripping regex is acceptable *here* because this is a display
 * helper, never a security boundary: its result is rendered as React text,
 * which escapes it again. On stored (already sanitized) markup it is exact,
 * since no attribute — and therefore no quoted `>` — can exist. On the editor's
 * live, unsanitized markup it may occasionally mis-split a preview; that is a
 * cosmetic risk only.
 */
export function noteHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
