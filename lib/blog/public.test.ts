import { describe, expect, it } from "vitest";

import { addHeadingIds, escapeXml, rewriteRelativeHrefs } from "./public";

describe("addHeadingIds", () => {
  it("adds slugified ids to h2/h3 and dedupes repeats", () => {
    expect(addHeadingIds("<h2>Hello World</h2><p>x</p><h3>Hello World</h3>")).toBe(
      '<h2 id="hello-world">Hello World</h2><p>x</p><h3 id="hello-world-2">Hello World</h3>'
    );
  });

  it("leaves headings with no usable text untouched", () => {
    expect(addHeadingIds("<h2>!!!</h2>")).toBe("<h2>!!!</h2>");
  });
});

describe("rewriteRelativeHrefs", () => {
  it("absolutises root-relative hrefs only", () => {
    expect(
      rewriteRelativeHrefs(
        '<a href="/projects" rel="noopener noreferrer">p</a><a href="https://x.y/z" rel="noopener noreferrer" target="_blank">e</a>',
        "https://www.patrickbeasley.com"
      )
    ).toBe(
      '<a href="https://www.patrickbeasley.com/projects" rel="noopener noreferrer">p</a><a href="https://x.y/z" rel="noopener noreferrer" target="_blank">e</a>'
    );
  });
});

describe("escapeXml", () => {
  it("escapes the five XML specials", () => {
    expect(escapeXml(`<a & 'b' "c">`)).toBe("&lt;a &amp; &apos;b&apos; &quot;c&quot;&gt;");
  });
});
