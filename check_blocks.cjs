const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists || firstAllowlists);
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlists || firstAllowlists);

// Extract the section between first [[allowlists]] and first [[rules]]
let sectionText = tomlContent.substring(firstAllowlists || firstAllowlists, firstRulesPos);

// Extract all '''...''' blocks using the test's regex
const re = /'''(.*?)'''/gs;
const configuredLines = [];
let m;
while ((m = re.exec(sectionText)) !== null) {
  configuredLines.push(m[1]);
}

console.log(`Blocks extracted by test regex: ${configuredLines.length}`);
console.log(`Expected: 84`);

// Show first 10 extracted lines
console.log("\n--- First 10 extracted blocks ---");
for (let j = 0; j < Math.min(10, configuredLines.length); j++) {
  console.log(`\nBlock ${j+1} (first 60): ${JSON.stringify(configuredLines[j]).substring(0, 60)}`);
}

// Now compare with expected entries from mjs
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");
const idx = mjsContent.indexOf("expectedAllowlistExpressions");
const afterEq = mjsContent.indexOf("= [", idx) + 2;
const nextArray = mjsContent.indexOf(" = [", afterEq);
const arrayText = mjsContent.substring(afterEq, nextArray);

const expectedEntries = [];
let i = 0;
while (i < arrayText.length) {
  while (i < arrayText.length && /[\\s\\n]/.test(arrayText[i])) i++;
  if (i >= arrayText.length) break;
  if (arrayText[i] === '"') {
    i++; // skip opening quote
    let entry = "";
    while (i < arrayText.length) {
      if (arrayText[i] === '\\' && i + 1 < arrayText.length) {
        entry += arrayText[i] + arrayText[i+1];
        i += 2;
      } else if (arrayText[i] === '"') {
        expectedEntries.push(entry);
        i++; // skip closing quote
        break;
      } else {
        entry += arrayText[i];
        i++;
      }
    }
  } else { i++; }
}

console.log(`\nExpected entries from mjs: ${expectedEntries.length}`);

// Compare
console.log("\n--- First 10 comparison ---");
for (let j = 0; j < Math.min(10, configuredLines.length, expectedEntries.length); j++) {
  const match = configuredLines[j] === expectedEntries[j] ? "MATCH" : "MISMATCH";
  console.log(`\nEntry ${j+1}: ${match}`);
  if (match === "MISMATCH") {
    console.log(`  Configured:  ${JSON.stringify(configuredLines[j]).substring(0, 50)}`);
    console.log(`  Expected:    ${JSON.stringify(expectedEntries[j]).substring(0, 50)}`);
  }
}