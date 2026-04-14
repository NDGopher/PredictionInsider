import { spawnSync } from "node:child_process";

/**
 * Windows often has `py -3` but not `python` on PATH; Linux/macOS use python3/python.
 * Used by scheduled pipeline so background refresh actually runs.
 */
export function resolvePythonCommand(): { command: string; prefixArgs: string[] } {
  const ok = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

  if (process.platform === "win32") {
    if (ok("py", ["-3", "--version"])) return { command: "py", prefixArgs: ["-3"] };
    if (ok("python", ["--version"])) return { command: "python", prefixArgs: [] };
    if (ok("python3", ["--version"])) return { command: "python3", prefixArgs: [] };
    return { command: "py", prefixArgs: ["-3"] };
  }
  if (ok("python3", ["--version"])) return { command: "python3", prefixArgs: [] };
  if (ok("python", ["--version"])) return { command: "python", prefixArgs: [] };
  return { command: "python3", prefixArgs: [] };
}
