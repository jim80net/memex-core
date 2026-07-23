#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  type ConsistencyManifest,
  parseAuditContractArgs,
  runConsistencyAudit,
} from "./consistency.js";

async function main(): Promise<void> {
  const manifestPath = parseAuditContractArgs(process.argv.slice(2));
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
