const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlists);

console.log(`First [[allowlists]] at: ${firstAllowlists || firstAllowlists}`);
console.log(`First [[rules]] at: ${firstRulesPos}`);

// Extract section between first [[allowlists]] and first [[rules]]
let sectionText = tomlContent.substring(firstAllowlists, firstRulesPos);

// Extract all '''...''' blocks using the test's regex
const re = /'''(.*?)'''/gs;
const configuredLines = [];
let m;
while ((m = re.exec(sectionText)) !== null) {
  configuredLines.push(m[1]);
}

console.log(`\nBlocks extracted by test regex from first section: ${configuredLines.length}`);

// Show first 5
for (let j = 0; j < Math.min(5, configuredLines.length); j++) {
  console.log(`\nBlock ${j+1} (first 50): ${JSON.stringify(configuredLines[j]).substring(0, 50)}`);
}