// Rename hashed DTS filenames produced by tsdown to stable names
import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const dir = "dist";

for (const file of readdirSync(dir)) {
  if (file.endsWith(".d.ts") && file !== "index.d.ts") {
    renameSync(join(dir, file), join(dir, "index.d.ts"));
  }
  if (file.endsWith(".d.ts.map") && file !== "index.d.ts.map") {
    renameSync(join(dir, file), join(dir, "index.d.ts.map"));
  }
}
