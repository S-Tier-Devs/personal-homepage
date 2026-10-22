import { describe, expect, it } from "vitest";

import { sanitizePostHtml } from "./sanitize";

const CDN = "https://pb-public-media.nyc3.cdn.digitaloceanspaces.com";
const opts = { mediaOrigin: CDN };

describe("sanitizePostHtml — tags", () => {
  it("keeps the post subset, including div, and drops everything else, keeping text", () => {
    // <div> is in the post profile's allowlist (contenteditable emits one per
    // line — see RichTextEditor's mount effect and buildPostProfile in
    // lib/sanitize.ts), so it round-trips rather than being dropped.
    expect(
      sanitizePostHtml(
        "<h2>Title</h2><blockquote><p>q</p></blockquote><pre><code>x=1</code></pre><hr><div>text</div>",
        opts
      )
    ).toBe(
      "<h2>Title</h2><blockquote><p>q</p></blockquote><pre><code>x=1</code></pre><hr><div>text</div>"
    );
  });

  // Regression: browsers emit a <div> per line in contenteditable. Before div
  // was added to the allowlist, the unknown-tag-drop rule kept the text but
  // discarded the tag, which merged adjacent lines' words together with no
  // separator at all — not just losing paragraph structure.
  it("keeps per-line <div> wrappers instead of merging their text", () => {
    expect(sanitizePostHtml("line1<div>line2</div>", opts)).toBe(
      "line1<div>line2</div>"
    );
  });

  it("still discards script/style contents entirely", () => {
    expect(sanitizePostHtml("<p>a</p><script>alert(1)</script>", opts)).toBe("<p>a</p>");
  });
});

describe("sanitizePostHtml — href", () => {
  it("keeps https links, adding rel and target", () => {
    expect(sanitizePostHtml('<a href="https://example.com/x">t</a>', opts)).toBe(
      '<a href="https://example.com/x" rel="noopener noreferrer" target="_blank">t</a>'
    );
  });

  it("keeps mailto links", () => {
    expect(sanitizePostHtml('<a href="mailto:a@b.c">m</a>', opts)).toBe(
      '<a href="mailto:a@b.c" rel="noopener noreferrer" target="_blank">m</a>'
    );
  });

  it("keeps root-relative paths without target", () => {
    expect(sanitizePostHtml('<a href="/projects?x=1#y">p</a>', opts)).toBe(
      '<a href="/projects?x=1#y" rel="noopener noreferrer">p</a>'
    );
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,x",
    "//evil.com/x",
    "/\\evil.com",
    "&#106;avascript:alert(1)",
    "jav&#x61;script:alert(1)",
    "ftp://evil.com",
  ])("drops dangerous href %s but keeps the anchor text", (href) => {
    expect(sanitizePostHtml(`<a href="${href}">t</a>`, opts)).toBe(
      '<a rel="noopener noreferrer">t</a>'
    );
  });

  it("drops event handlers and unknown attributes", () => {
    expect(
      sanitizePostHtml('<a href="/x" onclick="evil()" style="x" data-y="z">t</a>', opts)
    ).toBe('<a href="/x" rel="noopener noreferrer">t</a>');
  });

  // Regression: the PARSED href can resolve to the right origin while its
  // re-SERIALIZED pathname collapses "/.." or "/." into the protocol-relative
  // "//evil.com", which a second resolution sends off-site. Validating the
  // parsed URL object (as sanitizeHref originally did) misses this — only a
  // round-trip over the EMITTED string catches it. "&#47;" is an HTML entity
  // for "/", decoded before validation, so "/..&#47;/evil.com" reduces to
  // "/..//evil.com" by the time sanitizeHref sees it.
  it.each([
    "/..//evil.com",
    "/.//evil.com",
    "/%2e%2e//evil.com",
    "/..&#47;/evil.com",
  ])("drops the normalization-smuggled href %s but keeps the anchor text", (href) => {
    expect(sanitizePostHtml(`<a href="${href}">t</a>`, opts)).toBe(
      '<a rel="noopener noreferrer">t</a>'
    );
  });
});

describe("sanitizePostHtml — img", () => {
  it("keeps on-CDN images with alt, width, height", () => {
    expect(
      sanitizePostHtml(`<img src="${CDN}/blog/2026/10/a.png" alt="A &quot;b&quot;" width="800" height="600">`, opts)
    ).toBe(
      `<img src="${CDN}/blog/2026/10/a.png" alt="A &quot;b&quot;" width="800" height="600">`
    );
  });

  it("drops the whole element for off-origin src", () => {
    expect(sanitizePostHtml('<p>x</p><img src="https://evil.com/p.png">', opts)).toBe(
      "<p>x</p>"
    );
  });

  it("drops the whole element when src is missing or unparseable", () => {
    expect(sanitizePostHtml("<img alt='x'>", opts)).toBe("");
  });

  it("drops all images when no mediaOrigin is configured", () => {
    expect(
      sanitizePostHtml(`<img src="${CDN}/a.png">`, { mediaOrigin: null })
    ).toBe("");
  });

  it("drops non-integer or out-of-range dimensions but keeps the image", () => {
    expect(
      sanitizePostHtml(`<img src="${CDN}/a.png" width="12px" height="99999">`, opts)
    ).toBe(`<img src="${CDN}/a.png">`);
  });

  it("truncates alt to 300 chars", () => {
    const alt = "a".repeat(400);
    const out = sanitizePostHtml(`<img src="${CDN}/a.png" alt="${alt}">`, opts);

    expect(out).toBe(`<img src="${CDN}/a.png" alt="${"a".repeat(300)}">`);
  });
});

describe("sanitizePostHtml — idempotence", () => {
  it("sanitizing twice equals sanitizing once", () => {
    const input = [
      '<h2>T</h2><p>a &amp; b</p><a href="https://x.y/z?a=1&b=2">l</a>',
      `<img src="${CDN}/i.png" alt="q&quot;x" width="10" height="20">`,
      "<ul><li>1</li></ul><pre><code>&lt;tag&gt;</code></pre>",
    ].join("");
    const once = sanitizePostHtml(input, opts);

    expect(sanitizePostHtml(once, opts)).toBe(once);
  });

  // Regression: before the round-trip fix, a normalization-smuggled href
  // survived the first pass as a live "//evil.com" link, then got stripped
  // on the second pass once the parser saw the now-literal "//evil.com" — a
  // second sanitize producing different, *more* dangerous output than the
  // first is an idempotence break, not just a one-off escape.
  it("sanitizing twice equals sanitizing once for a normalization-smuggled href", () => {
    const input = '<a href="/..//evil.com">l</a>';
    const once = sanitizePostHtml(input, opts);

    expect(once).toBe('<a rel="noopener noreferrer">l</a>');
    expect(sanitizePostHtml(once, opts)).toBe(once);
  });
});
