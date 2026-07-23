#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ConsistencyManifest, runConsistencyAudit } from "./consistency.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--manifest") {
    throw new Error("expected: memex-core-consistency --manifest <path>");
  }
  const manifestPath = resolve(args[1]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ConsistencyManifest;
  const report = await runConsistencyAudit(manifest, manifestPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      ok: false,
      checks: [
        { id: "command", ok: false, error: error instanceof Error ? error.message : String(error) },
      ],
    })}\n`,
  );
  process.exitCode = 1;
});
