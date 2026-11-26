const fs = require("fs");
const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Extract blocks from TOML allowlist section (between [[allowlists]] and [[rules]])
const allowlistsStart = tomlContent.indexOf("[[allowlists]]");
const rulesStart = tomlContent.indexOf("[[rules]]", allowlistsStart);
const allowlistSection = tomlContent.substring(allowlistsStart, rulesStart);

const blocks = [];
const re = /'''(.*?)'''/gs;
let m;
while ((m = re.exec(allowlistSection)) !== null) {
  blocks.push(m[1]);
}

console.log("Found " + blocks.length + " blocks from TOML allowlist section");

// Print first 10 blocks in JSON
for (var j = 0; j < Math.min(10, blocks.length); j++) {
  console.log("Block " + (j+1) + ": " + JSON.stringify(blocks[j]));
}