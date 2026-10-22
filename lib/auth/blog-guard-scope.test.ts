import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every .ts/.tsx file under a directory, found without any gitignored-tree
 * walking (a plain readdir recursion is safe here — app/, components/, and
 * lib/ have no node_modules beneath them).
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }

  return out;
}

/**
 * Files that are allowed to mention "blog-guard" without being an offender:
 * the guard's own implementation, its unit test, and this scope test itself
 * (whose string literal "blog-guard" would otherwise flag itself).
 */
function isExemptFromScope(file: string, authDir: string): boolean {
  const relative = path.relative(authDir, file);

  return (
    relative === "blog-guard.ts" ||
    relative === "blog-guard.test.ts" ||
    relative === "blog-guard-scope.test.ts"
  );
}

describe("requireBlogAuth blast radius", () => {
  it("is imported only by files under app/api/blog/", () => {
    // AGENTS.md's invariant is project-wide — ONLY app/api/blog/** may import
    // the blog guard — not just "route.ts under app/api/**". The previous
    // version of this test scanned only app/api/**/route.ts, which would
    // miss an import from, say, a components/ or lib/ helper, or a non-route
    // file under app/api/ outside app/api/blog/. Scan the three trees the
    // invariant actually governs.
    const root = process.cwd();
    const authDir = path.join(root, "lib", "auth");
    const blogApiDir = path.join(root, "app", "api", "blog") + path.sep;

    const files = [
      ...sourceFiles(path.join(root, "app")),
      ...sourceFiles(path.join(root, "components")),
      ...sourceFiles(path.join(root, "lib")),
    ];

    const offenders = files.filter((file) => {
      if (isExemptFromScope(file, authDir)) return false;
      if (!readFileSync(file, "utf8").includes("blog-guard")) return false;

      return !file.startsWith(blogApiDir);
    });

    expect(offenders).toEqual([]);
  });
});
