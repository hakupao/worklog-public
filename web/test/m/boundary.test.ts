// web/test/m/boundary.test.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("src");
function resolveFrom(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
/** Every file the entry reaches through relative imports (static, dynamic, side-effect), plus the bare packages. */
function graph(entry: string) {
  const files = new Set<string>(), bare = new Set<string>(), todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) { const r = resolveFrom(f, spec); if (r) todo.push(r); } else bare.add(spec);
    }
  }
  return { files: [...files].map((f) => path.relative(SRC, f)), bare: [...bare] };
}

describe("phone bundle boundary", () => {
  it("MobileApp reaches no LED / world / ink / v2 page / drawer / v2 stylesheet module and no echarts", () => {
    const { files, bare } = graph(path.join(SRC, "m/MobileApp.tsx"));
    expect(files).toContain("m/pages/Now.tsx");
    // B2: the lazy badge chunk reaches world/store.ts (Badge's useWorld); it imports only react and a type — no LED, ink or style code.
    expect(files.filter((f) => f !== "world/store.ts" && /^(led|world|ink|styles)\/|SessionDrawer|TaskDrawer|^pages\/[A-Z]\w*Page\.tsx$/.test(f))).toEqual([]);
    expect(bare.filter((b) => b.startsWith("echarts"))).toEqual([]);
  });
});
