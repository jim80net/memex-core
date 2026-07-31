import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ExceptionExpiryManifest = {
  schemaVersion: 1;
  exceptionId: string;
  advisoryId: string;
  transformersPackage: string;
  sharpPackage: string;
  knownVulnerableSharpVersion: string;
  firstPatchedSharpVersion: string;
  disposition: {
    status: string;
    reviewedAt: string;
    approvedThrough: string;
    expiresAt: string;
    owner: string;
    issue: string;
  };
};

export type ExceptionExpiryCheck = {
  id: string;
  ok: boolean;
  evidence?: Record<string, unknown>;
  error?: string;
};

export type ExceptionExpiryReport = {
  schemaVersion: 1;
  ok: boolean;
  status: "exception-valid" | "exit-available" | "expired" | "indeterminate";
  checkedAt: string;
  exceptionId: string;
  checks: ExceptionExpiryCheck[];
};

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  dependencies?: Record<string, unknown>;
  dist?: { integrity?: unknown; shasum?: unknown };
};

type Advisory = {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  severity?: unknown;
  vulnerable_versions?: unknown;
};

type Version = [number, number, number];

const registryBase = "https://registry.npmjs.org";

function parseVersion(value: string): Version | undefined {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function caretUpperBound(version: Version): Version {
  if (version[0] > 0) return [version[0] + 1, 0, 0];
  if (version[1] > 0) return [0, version[1] + 1, 0];
  return [0, 0, version[2] + 1];
}

function tildeUpperBound(version: Version): Version {
  return [version[0], version[1] + 1, 0];
}

function evaluateComparatorSet(range: string, candidate: Version): boolean | undefined {
  const expression = range.trim();
  if (expression === "*" || expression.toLowerCase() === "latest") return true;

  const shorthand = expression.match(/^([~^])\s*(v?\d+\.\d+\.\d+)$/);
  if (shorthand) {
    const lower = parseVersion(shorthand[2]);
    if (!lower) return undefined;
    const upper = shorthand[1] === "^" ? caretUpperBound(lower) : tildeUpperBound(lower);
    return compareVersion(candidate, lower) >= 0 && compareVersion(candidate, upper) < 0;
  }

  const exact = parseVersion(expression);
  if (exact) return compareVersion(candidate, exact) === 0;

  const tokens = expression.split(/\s+/);
  if (tokens.length === 0) return undefined;
  let evaluated = false;
  for (const token of tokens) {
    const match = token.match(/^(<=|>=|<|>|=)?(v?\d+\.\d+\.\d+)$/);
    if (!match) return undefined;
    const boundary = parseVersion(match[2]);
    if (!boundary) return undefined;
    evaluated = true;
    const comparison = compareVersion(candidate, boundary);
    const matches =
      match[1] === ">="
        ? comparison >= 0
        : match[1] === ">"
          ? comparison > 0
          : match[1] === "<="
            ? comparison <= 0
            : match[1] === "<"
              ? comparison < 0
              : comparison === 0;
    if (!matches) return false;
  }
  return evaluated ? true : undefined;
}

export function rangeAdmitsVersion(range: string, version: string): boolean | undefined {
  const candidate = parseVersion(version);
  if (!candidate) return undefined;
  const alternatives = range.split("||");
  let supported = false;
  for (const alternative of alternatives) {
    const result = evaluateComparatorSet(alternative, candidate);
    if (result === true) return true;
    if (result === false) supported = true;
  }
  return supported ? false : undefined;
}

async function fetchJson(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), ...init });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return response.json();
}

async function fetchManifest(
  fetcher: typeof fetch,
  packageName: string,
  version: string,
): Promise<PackageManifest> {
  return (await fetchJson(
    fetcher,
    `${registryBase}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
  )) as PackageManifest;
}

async function fetchAdvisories(
  fetcher: typeof fetch,
  packageName: string,
  version: string,
): Promise<Advisory[]> {
  const result = (await fetchJson(fetcher, `${registryBase}/-/npm/v1/security/advisories/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [packageName]: [version] }),
  })) as Record<string, unknown>;
  const advisories = result[packageName];
  if (advisories === undefined) return [];
  if (!Array.isArray(advisories)) throw new Error("npm advisory response omitted package evidence");
  return advisories as Advisory[];
}

function matchesAdvisory(advisory: Advisory, advisoryId: string): boolean {
  return typeof advisory.url === "string" && advisory.url.endsWith(`/advisories/${advisoryId}`);
}

function packageEvidence(manifest: PackageManifest): Record<string, unknown> {
  return {
    name: manifest.name,
    version: manifest.version,
    integrity: manifest.dist?.integrity,
    shasum: manifest.dist?.shasum,
  };
}

export function parseExceptionExpiryArgs(args: string[], cwd = process.cwd()): string {
  if (!args.includes("--json")) {
    throw new Error("expected: check-exception-expiry --json [--manifest <path>]");
  }
  const remaining = args.filter((argument) => argument !== "--json");
  if (
    !(
      remaining.length === 0 ||
      (remaining.length === 2 && remaining[0] === "--manifest" && remaining[1])
    )
  ) {
    throw new Error("expected: check-exception-expiry --json [--manifest <path>]");
  }
  return resolve(cwd, remaining[1] ?? ".github/security-exceptions/transformers-sharp.json");
}

export async function loadExceptionExpiryManifest(
  manifestPath: string,
): Promise<ExceptionExpiryManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ExceptionExpiryManifest;
}

export async function runExceptionExpiryCheck(
  manifest: ExceptionExpiryManifest,
  options: { now?: Date; fetcher?: typeof fetch } = {},
): Promise<ExceptionExpiryReport> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const checks: ExceptionExpiryCheck[] = [];
  const expiresAt = new Date(manifest.disposition?.expiresAt);
  const manifestOk =
    manifest.schemaVersion === 1 &&
    manifest.exceptionId.length > 0 &&
    manifest.advisoryId.length > 0 &&
    manifest.disposition?.status.length > 0 &&
    manifest.disposition?.owner.length > 0 &&
    manifest.disposition?.issue.length > 0 &&
    !Number.isNaN(expiresAt.getTime());
  checks.push({
    id: "manifest",
    ok: manifestOk,
    evidence: {
      disposition: manifest.disposition?.status,
      reviewedAt: manifest.disposition?.reviewedAt,
      approvedThrough: manifest.disposition?.approvedThrough,
      expiresAt: manifest.disposition?.expiresAt,
      owner: manifest.disposition?.owner,
      issue: manifest.disposition?.issue,
    },
    ...(!manifestOk ? { error: "exception disposition manifest is incomplete or invalid" } : {}),
  });

  const dispositionCurrent = manifestOk && now.getTime() < expiresAt.getTime();
  checks.push({
    id: "disposition-current",
    ok: dispositionCurrent,
    evidence: { checkedAt: now.toISOString(), expiresAt: manifest.disposition?.expiresAt },
    ...(!dispositionCurrent
      ? { error: "exception disposition expired without a renewed checked-in disposition" }
      : {}),
  });

  let upstreamExitAvailable = false;
  try {
    const transformers = await fetchManifest(fetcher, manifest.transformersPackage, "latest");
    const sharpDeclaration = transformers.dependencies?.[manifest.sharpPackage];
    const valid =
      transformers.name === manifest.transformersPackage &&
      typeof transformers.version === "string" &&
      typeof sharpDeclaration === "string";
    checks.push({
      id: "transformers-manifest",
      ok: valid,
      evidence: { ...packageEvidence(transformers), sharpDeclaration },
      ...(!valid ? { error: "latest Transformers manifest omitted exact Sharp declaration" } : {}),
    });
    if (typeof sharpDeclaration === "string") {
      const rangeResult = rangeAdmitsVersion(sharpDeclaration, manifest.firstPatchedSharpVersion);
      upstreamExitAvailable = rangeResult === true;
      checks.push({
        id: "transformers-sharp-range",
        ok: rangeResult !== undefined,
        evidence: {
          sharpDeclaration,
          firstPatchedSharpVersion: manifest.firstPatchedSharpVersion,
          admitsPatchedSharp: rangeResult,
        },
        ...(rangeResult === undefined
          ? { error: "unsupported Sharp declaration; cannot prove patched-version admission" }
          : {}),
      });
    }
  } catch (error) {
    checks.push({
      id: "transformers-manifest",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [knownVulnerable, firstPatched, latest] = await Promise.all([
      fetchManifest(fetcher, manifest.sharpPackage, manifest.knownVulnerableSharpVersion),
      fetchManifest(fetcher, manifest.sharpPackage, manifest.firstPatchedSharpVersion),
      fetchManifest(fetcher, manifest.sharpPackage, "latest"),
    ]);
    const valid = [knownVulnerable, firstPatched, latest].every(
      (item) => item.name === manifest.sharpPackage && typeof item.version === "string",
    );
    checks.push({
      id: "sharp-manifests",
      ok: valid,
      evidence: {
        knownVulnerable: packageEvidence(knownVulnerable),
        firstPatched: packageEvidence(firstPatched),
        latest: packageEvidence(latest),
      },
      ...(!valid ? { error: "Sharp registry manifests are incomplete or inconsistent" } : {}),
    });
  } catch (error) {
    checks.push({
      id: "sharp-manifests",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [vulnerableAdvisories, patchedAdvisories] = await Promise.all([
      fetchAdvisories(fetcher, manifest.sharpPackage, manifest.knownVulnerableSharpVersion),
      fetchAdvisories(fetcher, manifest.sharpPackage, manifest.firstPatchedSharpVersion),
    ]);
    const advisory = vulnerableAdvisories.find((item) =>
      matchesAdvisory(item, manifest.advisoryId),
    );
    const vulnerableEvidenceOk = Boolean(advisory);
    checks.push({
      id: "advisory-vulnerable-version",
      ok: vulnerableEvidenceOk,
      evidence: {
        version: manifest.knownVulnerableSharpVersion,
        advisory,
      },
      ...(!vulnerableEvidenceOk
        ? { error: "configured advisory was not returned for known vulnerable Sharp" }
        : {}),
    });
    const patchedAdvisory = patchedAdvisories.find((item) =>
      matchesAdvisory(item, manifest.advisoryId),
    );
    checks.push({
      id: "advisory-patched-version",
      ok: !patchedAdvisory,
      evidence: {
        version: manifest.firstPatchedSharpVersion,
        advisory: patchedAdvisory,
      },
      ...(patchedAdvisory
        ? { error: "configured first patched Sharp version is currently advisory-affected" }
        : {}),
    });
  } catch (error) {
    checks.push({
      id: "advisory-state",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const ok = checks.every((check) => check.ok);
  const status = !dispositionCurrent
    ? "expired"
    : !ok
      ? "indeterminate"
      : upstreamExitAvailable
        ? "exit-available"
        : "exception-valid";
  return {
    schemaVersion: 1,
    ok,
    status,
    checkedAt: now.toISOString(),
    exceptionId: manifest.exceptionId,
    checks,
  };
}
