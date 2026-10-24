// Syntax-check every JS file of the extension with Node's parser.
// GJS-specific syntax (imports.gi etc.) is standard ESM, so `node --check`
// on the module source is a valid check.
//
// Run with: node check_syntax.mjs
import { readdirSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (extname(full) === ".js") {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (e) {
    failed++;
    const out = (e.stderr?.toString() || e.stdout?.toString() || e.message);
    console.log(`\n=== ${file} ===`);
    console.log(out.split("\n").slice(0, 8).join("\n"));
  }
}

console.log(`\nchecked ${files.length} files, ${failed} with syntax errors`);
process.exit(failed ? 1 : 0);
