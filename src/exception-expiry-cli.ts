#!/usr/bin/env node
import {
  loadExceptionExpiryManifest,
  parseExceptionExpiryArgs,
  runExceptionExpiryCheck,
} from "./exception-expiry.js";

async function main(): Promise<void> {
  const manifestPath = parseExceptionExpiryArgs(process.argv.slice(2));
  const manifest = await loadExceptionExpiryManifest(manifestPath);
  const report = await runExceptionExpiryCheck(manifest);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      ok: false,
      status: "indeterminate",
      checkedAt: new Date().toISOString(),
      exceptionId: "unknown",
      checks: [
        { id: "command", ok: false, error: error instanceof Error ? error.message : String(error) },
      ],
    })}\n`,
  );
  process.exitCode = 1;
});
