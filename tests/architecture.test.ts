// Guards the dependency rules described in ARCHITECTURE.md, so they can't erode silently.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function filesIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return filesIn(path);
    return /\.tsx?$/.test(name) ? [path.split(sep).join("/")] : [];
  });
}

interface Import {
  specifier: string;
  typeOnly: boolean;
}

/** Static imports and requires. `import type` is recorded separately: it's erased at runtime. */
function importsOf(file: string): Import[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const found: Import[] = [];
  for (const match of source.matchAll(/^\s*import\s+(type\s+)?[^"';]*?from\s+["']([^"']+)["']/gm)) {
    found.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) found.push({ specifier: match[1], typeOnly: false });
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1], typeOnly: false });
  return found;
}

/** Resolves a relative import to a repo path without extension, e.g. "example/src/domain/message". */
function resolve(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const base = file.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") base.pop();
    else if (part !== ".") base.push(part);
  }
  return base.join("/").replace(/\.tsx?$/, "");
}

function check(files: string[], allowed: (target: string, imp: Import) => boolean) {
  for (const file of files) {
    for (const imp of importsOf(file)) {
      const target = resolve(file, imp.specifier);
      assert.ok(allowed(target, imp), `${file} must not import "${imp.specifier}"`);
    }
  }
}

describe("kit: components/ai", () => {
  const pure = ["components/ai/markdown.ts", "components/ai/highlight.ts"];
  const components = filesIn("components/ai").filter((f) => f.endsWith(".tsx"));

  test("pure modules import nothing (no React, no React Native)", () => check(pure, () => false));

  test("components only use React, React Native, Reanimated, expo-clipboard and sibling modules", () => {
    const external = new Set(["react", "react-native", "react-native-reanimated", "expo-clipboard"]);
    check(components, (target) => external.has(target) || target.startsWith("components/ai/"));
  });

  test("every component file is listed in the README's copy instructions", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const file of filesIn("components/ai")) {
      const name = file.split("/").pop()!;
      assert.ok(readme.includes(`curl -O $BASE/${name}`), `README is missing "curl -O $BASE/${name}"`);
    }
  });
});

describe("example app: clean architecture layers", () => {
  const layer = (name: string) => filesIn(`example/src/${name}`);

  test("domain depends on nothing but itself", () =>
    check(layer("domain"), (target) => target.startsWith("example/src/domain/")));

  test("application depends on domain only (plus React for the hook adapter)", () =>
    check(layer("application"), (target, imp) => {
      if (target.startsWith("example/src/domain/")) return imp.typeOnly;
      if (target.startsWith("example/src/application/")) return true;
      return target === "react";
    }));

  test("chat-session.ts stays framework-free (runs in Node tests)", () =>
    check(["example/src/application/chat-session.ts"], (target, imp) => imp.typeOnly && target.startsWith("example/src/domain/")));

  test("infrastructure implements domain ports and never reaches into application or UI", () =>
    check(layer("infrastructure"), (target) => target.startsWith("example/src/domain/") || target.startsWith("example/src/infrastructure/")));

  test("UI depends on application, domain types and the kit, never on infrastructure", () =>
    check(layer("ui"), (target, imp) => {
      if (target.startsWith("example/src/infrastructure/")) return false;
      if (target.startsWith("example/src/domain/")) return imp.typeOnly;
      return !target.startsWith("example/") || target.startsWith("example/src/ui/") || target.startsWith("example/src/application/");
    }));

  test("only App.tsx (the composition root) picks adapters", () => {
    const users = filesIn("example")
      .filter((f) => !f.includes("node_modules") && f !== "example/App.tsx" && !f.startsWith("example/src/infrastructure/"))
      .filter((f) => importsOf(f).some((imp) => resolve(f, imp.specifier).startsWith("example/src/infrastructure/")));
    assert.deepEqual(users, []);
  });
});

test("architecture test sees the files it guards", () => {
  assert.ok(filesIn("example/src").length >= 10, relative(ROOT, "example/src"));
});
