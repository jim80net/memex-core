/**
 * Encode an absolute path to a project directory name.
 * `/home/user/.myproject` → `-home-user--myproject`
 *
 * Rules:
 * - `/` becomes `-`
 * - `.` becomes `-`
 * - `_` becomes `-`
 * - Consecutive `-` are preserved (they encode dots/separators)
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, "-").replace(/\./g, "-").replace(/_/g, "-");
}
