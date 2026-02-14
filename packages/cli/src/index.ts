import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@canmi/seam-cli-darwin-arm64",
  "darwin-x64": "@canmi/seam-cli-darwin-x64",
  "linux-x64": "@canmi/seam-cli-linux-x64",
  "linux-arm64": "@canmi/seam-cli-linux-arm64",
};

function findBinary(): string | null {
  const key = `${process.platform}-${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (pkg) {
    try {
      const pkgDir = join(require.resolve(`${pkg}/package.json`), "..");
      const bin = join(pkgDir, "bin", "seam");
      if (existsSync(bin)) return bin;
    } catch {
      // Platform package not installed, fall through to PATH
    }
  }
  return null;
}

const binary = findBinary();
const args = process.argv.slice(2);

try {
  if (binary) {
    execFileSync(binary, args, { stdio: "inherit" });
  } else {
    // Fallback: assume `seam` is on PATH (e.g. installed via cargo install)
    execFileSync("seam", args, { stdio: "inherit" });
  }
} catch (err: unknown) {
  if (err && typeof err === "object" && "status" in err) {
    process.exit((err as { status: number }).status ?? 1);
  }
  console.error("Failed to execute seam CLI:", err);
  process.exit(1);
}
