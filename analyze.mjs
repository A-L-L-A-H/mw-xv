const fs = require("fs");

// Read current TOML
let tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// The expected entries from check-gitleaks-config.mjs (I'll extract these)
// For now, let me just look at entry 22 and its surrounding entries

// Let me extract the current block 22 and the expected entry 22
const allowlistsStart = tomlContent.indexOf("[[allowlists]]");
const rulesStart = tomlContent.indexOf("[[rules]]", allowlistsStart);
const allowlistSection = tomlContent.substring(allowlistsStart, rulesStart);

const re = /'''(.*?)'''/gs;
const blocks = [];
let m;
while ((m = re.exec(allowlistSection)) !== null) {
  blocks.push(m[1]);
}

// Entry 22 (0-indexed: 21) - ELASTIC_PASSWORD
console.log("Current block 22:", JSON.stringify(blocks[21]));
console.log("Current block 22 raw:", blocks[21]);

// Now let me also look at a few other problem entries to understand the pattern
for (let i of [0, 1, 4, 5, 21, 22, 26, 27]) {
  console.log(`\nBlock ${i+1}:`, JSON.stringify(blocks[i]));
  console.log(`Block ${i+1} raw len:${blocks[i].length}`);
}