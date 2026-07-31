import { describe, expect, it } from "vitest";
import {
  type ExceptionExpiryManifest,
  parseExceptionExpiryArgs,
  rangeAdmitsVersion,
  runExceptionExpiryCheck,
} from "../src/exception-expiry.ts";

const manifest: ExceptionExpiryManifest = {
  schemaVersion: 1,
  exceptionId: "transformers-sharp-ghsa-f88m-g3jw-g9cj",
  advisoryId: "GHSA-f88m-g3jw-g9cj",
  transformersPackage: "@huggingface/transformers",
  sharpPackage: "sharp",
  knownVulnerableSharpVersion: "0.34.5",
  firstPatchedSharpVersion: "0.35.0",
  disposition: {
    status: "runtime-guard-plus-application-owned-single-sharp-override",
    reviewedAt: "2026-07-30",
    approvedThrough: "2026-08-06",
    expiresAt: "2026-08-07T00:00:00.000Z",
    owner: "memex-core#46",
    issue: "https://github.com/jim80net/memex-core/issues/46",
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function registryFetch(sharpDeclaration = "^0.34.5"): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url.endsWith("%40huggingface%2Ftransformers/latest")) {
      return response({
        name: "@huggingface/transformers",
        version: "4.2.0",
        dependencies: { sharp: sharpDeclaration },
        dist: { integrity: "sha512-transformers" },
      });
    }
    if (url.includes("/sharp/0.34.5")) {
      return response({ name: "sharp", version: "0.34.5", dist: { integrity: "sha512-old" } });
    }
    if (url.includes("/sharp/0.35.0")) {
      return response({ name: "sharp", version: "0.35.0", dist: { integrity: "sha512-fixed" } });
    }
    if (url.endsWith("/sharp/latest")) {
      return response({ name: "sharp", version: "0.35.3", dist: { integrity: "sha512-latest" } });
    }
    if (url.endsWith("/-/npm/v1/security/advisories/bulk") && init?.body) {
      const request = JSON.parse(String(init.body)) as { sharp: string[] };
      return response(
        request.sharp[0] === "0.34.5"
          ? {
              sharp: [
                {
                  id: 1124066,
                  url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
                  severity: "high",
                  vulnerable_versions: "<0.35.0",
                },
              ],
            }
          : {},
      );
    }
    return response({ error: "not found" }, 404);
  }) as typeof fetch;
}

describe("rangeAdmitsVersion", () => {
  it("models the current zero-major caret boundary", () => {
    expect(rangeAdmitsVersion("^0.34.5", "0.35.0")).toBe(false);
    expect(rangeAdmitsVersion("^0.35.0", "0.35.0")).toBe(true);
    expect(rangeAdmitsVersion(">=0.35.0 <0.36.0", "0.35.0")).toBe(true);
  });

  it("fails closed for unsupported declarations", () => {
    expect(rangeAdmitsVersion("workspace:*", "0.35.0")).toBeUndefined();
  });
});

describe("runExceptionExpiryCheck", () => {
  it("returns current structured evidence before expiry", async () => {
    const report = await runExceptionExpiryCheck(manifest, {
      now: new Date("2026-07-31T12:00:00.000Z"),
      fetcher: registryFetch(),
    });
    expect(report).toMatchObject({ ok: true, status: "exception-valid" });
    expect(report.checks).toHaveLength(7);
    expect(report.checks.find((check) => check.id === "transformers-sharp-range")).toMatchObject({
      ok: true,
      evidence: { admitsPatchedSharp: false },
    });
  });

  it("fails closed after the disposition deadline even when upstream has exited", async () => {
    const report = await runExceptionExpiryCheck(manifest, {
      now: new Date("2026-08-07T00:00:00.000Z"),
      fetcher: registryFetch("^0.35.0"),
    });
    expect(report).toMatchObject({ ok: false, status: "expired" });
    expect(report.checks.find((check) => check.id === "disposition-current")).toMatchObject({
      ok: false,
      error: "exception disposition expired without a renewed checked-in disposition",
    });
  });

  it.each([
    ["missing reviewedAt", (value: ExceptionExpiryManifest) => delete value.disposition.reviewedAt],
    [
      "missing approvedThrough",
      (value: ExceptionExpiryManifest) => delete value.disposition.approvedThrough,
    ],
    [
      "invalid reviewedAt calendar date",
      (value: ExceptionExpiryManifest) => {
        value.disposition.reviewedAt = "2026-02-30";
      },
    ],
    [
      "review after approval",
      (value: ExceptionExpiryManifest) => {
        value.disposition.reviewedAt = "2026-08-07";
      },
    ],
    [
      "expiry inconsistent with approvedThrough",
      (value: ExceptionExpiryManifest) => {
        value.disposition.expiresAt = "2026-08-08T00:00:00.000Z";
      },
    ],
  ])("fails closed on %s", async (_name, mutate) => {
    const malformed = structuredClone(manifest);
    mutate(malformed);
    const report = await runExceptionExpiryCheck(malformed, {
      now: new Date("2026-07-31T12:00:00.000Z"),
      fetcher: registryFetch(),
    });
    expect(report).toMatchObject({ ok: false, status: "indeterminate" });
    expect(report.checks.find((check) => check.id === "manifest")).toMatchObject({
      ok: false,
      evidence: { datesConsistent: false },
      error: "exception disposition manifest is incomplete or invalid",
    });
  });

  it("fails closed when registry or advisory evidence is unavailable", async () => {
    const report = await runExceptionExpiryCheck(manifest, {
      now: new Date("2026-07-31T12:00:00.000Z"),
      fetcher: (async () => response({ error: "unavailable" }, 503)) as typeof fetch,
    });
    expect(report).toMatchObject({ ok: false, status: "indeterminate" });
    expect(report.checks.filter((check) => !check.ok)).toHaveLength(3);
  });
});

describe("parseExceptionExpiryArgs", () => {
  it("accepts only fail-closed JSON grammar", () => {
    expect(parseExceptionExpiryArgs(["--json"], "/repo")).toBe(
      "/repo/.github/security-exceptions/transformers-sharp.json",
    );
    expect(parseExceptionExpiryArgs(["--json", "--manifest", "exception.json"], "/repo")).toBe(
      "/repo/exception.json",
    );
    expect(() => parseExceptionExpiryArgs([])).toThrow("check-exception-expiry --json");
    expect(() => parseExceptionExpiryArgs(["--json", "--unknown"])).toThrow(
      "check-exception-expiry --json",
    );
  });
});
