import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Every route.ts under app/api, found without any gitignored-tree walking. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
    } else if (entry.name === "route.ts") {
      out.push(full);
    }
  }

  return out;
}

describe("requireBlogAuth blast radius", () => {
  it("is imported only by routes under app/api/blog/", () => {
    const apiDir = path.join(process.cwd(), "app", "api");
    const blogDir = path.join(apiDir, "blog") + path.sep;

    const offenders = routeFiles(apiDir).filter(
      (file) =>
        readFileSync(file, "utf8").includes("blog-guard") && !file.startsWith(blogDir)
    );

    expect(offenders).toEqual([]);
  });
});
