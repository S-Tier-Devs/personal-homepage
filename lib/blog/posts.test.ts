import { describe, expect, it } from "vitest";

import {
  POST_SLUG_MAX_LENGTH,
  deriveStatus,
  isLive,
  isValidSlug,
  normalizeTags,
  parsePublishedAtInput,
  readingMinutes,
  slugFromTitle,
} from "./posts";

describe("slugFromTitle", () => {
  it("lowercases, strips diacritics, hyphenates, trims", () => {
    expect(slugFromTitle("Héllo,  Wörld! — part 2")).toBe("hello-world-part-2");
  });

  it("caps at the slug max length without a trailing hyphen", () => {
    const slug = slugFromTitle("a".repeat(60) + " " + "b".repeat(60));

    expect(slug.length).toBeLessThanOrEqual(POST_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty for a title with no usable characters", () => {
    expect(slugFromTitle("!!!")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts the documented shape and rejects the rest", () => {
    expect(isValidSlug("my-post-2")).toBe(true);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("Upper")).toBe(false);
    expect(isValidSlug("a".repeat(101))).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("lowercases, hyphenates spaces, dedupes", () => {
    expect(normalizeTags(["Next JS", "next-js", "DB"])).toEqual(["next-js", "db"]);
  });

  it("rejects non-arrays, invalid tags, and more than 8", () => {
    expect(normalizeTags("nope")).toBeNull();
    expect(normalizeTags([""])).toBeNull();
    expect(normalizeTags(["ok", 3])).toBeNull();
    expect(normalizeTags(["a".repeat(33)])).toBeNull();
    expect(normalizeTags(Array.from({ length: 9 }, (_, i) => `t${i}`))).toBeNull();
  });
});

describe("readingMinutes", () => {
  it("is ceil(words/225) with a floor of 1", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("<p>word</p>")).toBe(1);
    expect(readingMinutes(`<p>${"word ".repeat(226)}</p>`)).toBe(2);
  });
});

describe("isLive / deriveStatus", () => {
  const now = new Date("2026-10-22T12:00:00Z");

  it("draft is never live", () => {
    expect(isLive({ status: "draft", published_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
    expect(deriveStatus({ status: "draft", published_at: null }, now)).toBe("draft");
  });

  it("published in the past is live", () => {
    const post = { status: "published", published_at: "2026-10-22T11:59:59Z" };

    expect(isLive(post, now)).toBe(true);
    expect(deriveStatus(post, now)).toBe("published");
  });

  it("published in the future is scheduled, not live", () => {
    const post = { status: "published", published_at: "2026-10-22T12:00:01Z" };

    expect(isLive(post, now)).toBe(false);
    expect(deriveStatus(post, now)).toBe("scheduled");
  });
});

describe("parsePublishedAtInput", () => {
  it("normalises a parseable datetime to ISO", () => {
    expect(parsePublishedAtInput("2026-10-22T12:00:00Z")).toBe("2026-10-22T12:00:00.000Z");
  });

  it("returns null for junk", () => {
    expect(parsePublishedAtInput("not a date")).toBeNull();
    expect(parsePublishedAtInput(42)).toBeNull();
    expect(parsePublishedAtInput("")).toBeNull();
  });
});
