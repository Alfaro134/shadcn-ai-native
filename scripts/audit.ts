// `npm audit` with a reviewed allowlist. Run from a package directory:
//   node ../scripts/audit.ts
//
// Fails on any high or critical advisory except the ones below, each assessed in SECURITY.md
// ("Known advisories"). npm audit has no ignore option, and dropping the gate would also hide new
// advisories. Remove an entry as soon as upstream ships a fix.
import { execSync } from "node:child_process";

const REVIEWED = new Set([
  "GHSA-vfj7-8cjw-p6xm", // braces <= 3.0.3: only parses the project's own globs at build time.
  "GHSA-86w9-cpqp-85rv", // node-forge <= 1.4.0: EAS Update code signing, which the example doesn't use.
]);

type Advisory = { url: string; severity: string; title: string };
type Report = { vulnerabilities: Record<string, { via: (string | Advisory)[] }> };

let stdout: string;
try {
  stdout = execSync("npm audit --json", { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds anything; the report is still on stdout.
  stdout = (error as { stdout?: string }).stdout ?? "";
}
const report = JSON.parse(stdout) as Report;

const blocking = new Map<string, string>();
for (const [name, { via }] of Object.entries(report.vulnerabilities ?? {})) {
  for (const advisory of via) {
    if (typeof advisory === "string") continue;
    if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
    const id = advisory.url.split("/").pop() ?? advisory.url;
    if (!REVIEWED.has(id)) blocking.set(id, `${advisory.severity} ${name}: ${advisory.title} (${advisory.url})`);
  }
}

if (blocking.size > 0) {
  console.error([...blocking.values()].join("\n"));
  console.error(`\n${blocking.size} unreviewed high/critical advisories. Fix them, or assess them in SECURITY.md and add them here.`);
  process.exit(1);
}
console.log("npm audit: no unreviewed high or critical advisories.");
