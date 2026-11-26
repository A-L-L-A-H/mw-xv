const fs = require("fs");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");
const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Extract expected lines from mjs
const arrayMatch = mjsContent.match(/export const expectedAllowlistExpressions = \[([\s\S]*?)\] \[/);
if (!arrayMatch) { console.log("No array found"); process.exit(1); }
const inner = arrayMatch[1];

// Extract quoted entries
const entries = [];
let i = 0;
while (i < inner.length) {
  while (i < inner.length && /[\s\n,]/.test(inner[i])) i++;
  if (i >= inner.length) break;
  if (inner[i] === '"') {
    i++;
    let entry = "";
    while (i < inner.length) {
      if (inner[i] === "\\" && i + 1 < inner.length) { entry += inner[i] + inner[i+1]; i += 2; }
      else if (inner[i] === '"') { entries.push(entry); i++; break; }
      else { entry += inner[i]; i++; }
    }
  } else { i++; }
}

// Extract blocks from TOML allowlist section
const allowlistsStart = tomlContent.indexOf("[[allowlists]]");
const rulesStart = tomlContent.indexOf("[[rules]]", allowlistsStart);
const allowlistSection = tomlContent.substring(allowlistsStart, rulesStart);

const blocks = [];
const re = /'''(.*?)'''/gs;
let m;
while ((m = re.exec(allowlistSection)) !== null) { blocks.push(m[1]); }

// Compare
let mismatches = 0;
for (let i = 0; i < entries.length; i++) {
  const expected = entries[i];
  const actual = blocks[i] || "MISSING";
  if (i >= blocks.length) { console.log(`Entry ${i+1}: MISSING`); mismatches++; continue; }
  if (expected !== actual) {
    mismatches++;
    console.log(`\nEntry ${i+1} MISMATCH:`);
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual:   ${JSON.stringify(actual)}`);
    let firstDiff = -1;
    const minLen = Math.min(expected.length, actual.length);
    for (let j = 0; j < minLen; j++) {
      if (expected[j] !== actual[j]) { firstDiff = j; break; }
    }
    if (firstDiff >= 0) {
      console.log(`  First diff at pos ${firstDiff}:`);
      console.log(`    Expected: code ${expected.charCodeAt(firstDiff)} '${expected[firstDiff]}'`);
      console.log(`    Actual:   code ${actual.charCodeAt(firstDiff)} '${actual[firstDiff]}'`);
    }
    const start = Math.max(0, firstDiff - 30);
    const end = Math.min(expected.length, actual.length, firstDiff + 30);
    console.log(`  Expected[${start}...${end}]: ${JSON.stringify(expected.substring(start, end))}`);
    console.log(`  Actual[${start}...${end}]:   ${JSON.stringify(actual.substring(start, end))}`);
  }
}
console.log(`\nTotal: ${entries.length} expected, ${blocks.length} actual, ${mismatches} mismatches`);