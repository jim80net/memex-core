import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a git command inside a directory. 30s timeout.
 */
export async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, timeout: 30_000 });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function hasRemote(dir: string): Promise<boolean> {
  try {
    const { stdout } = await git(["remote"], dir);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function hasCommits(dir: string): Promise<boolean> {
  try {
    await git(["rev-parse", "HEAD"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function getDefaultBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], dir);
    const ref = stdout.trim();
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch {
    try {
      const { stdout } = await git(["ls-remote", "--symref", "origin", "HEAD"], dir);
      const match = stdout.match(/ref:\s+refs\/heads\/(\S+)/);
      if (match) return match[1];
    } catch {
      // Fall through to default
    }
  }
  return "main";
}
