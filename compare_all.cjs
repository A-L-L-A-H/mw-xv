const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Extract section between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlights || firstAllowlists);
let sectionText = tomlContent.substring(firstAllowlists, firstRulesPos);

// Extract all '''...''' blocks using the test's regex
const re = /'''(.*?)'''/gs;
const configuredLines = [];
let m;
while ((m = re.exec(sectionText)) !== null) {
  configuredLines.push(m[1]);
}

console.log(`Blocks extracted by test regex: ${configuredLines.length}`);

// Expected entries from mjs
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

console.log(`Expected entries from mjs: ${expectedEntries.length}`);

// Compare all 84 entries (or as many as we have)
console.log("\n--- Comparing all entries ---");
let allMatch = true;
const compareCount = Math.min(configuredLines.length, expectedEntries.length);

for (let j = 0; j < compareCount; j++) {
  const match = configuredLines[j] === expectedEntries[j] ? "MATCH" : "MISMATCH";
  if (match === "MISMATCH") allMatch = false;
  if (j < 5 || j >= compareCount - 5 || match === "MISMATCH") {
    console.log(`\nEntry ${j+1}: ${match}`);
    if (match === "MISMATCH") {
      console.log(`  Configured (first 50):  ${JSON.stringify(configuredLines[j]).substring(0, 50)}`);
      console.log(`  Expected (first 50):    ${JSON.stringify(expectedEntries[j]).substring(0, 50)}`);
    }
  }
}

// Check if there are extra blocks beyond 84
if (configuredLines.length > expectedEntries.length) {
  console.log(`\n--- Extra blocks: ${configuredLines.length - expectedEntries.length} beyond expected 84 ---`);
  for (let j = expectedEntries.length; j < Math.min(configuredLines.length, expectedEntries.length + 10); j++) {
    console.log(`\nExtra block ${j+1} (first 60): ${JSON.stringify(configuredLines[j]).substring(0, 60)}`);
  }
}

// Check if there are fewer than 84
if (configuredLines.length < expectedEntries.length) {
  console.log(`\n--- Missing blocks: ${expectedEntries.length - configuredLines.length} beyond extracted ${configuredLines.length} ---`);
}

// Summary
console.log(`\n=== All ${compareCount} compared entries match: ${allMatch ? "YES" : "NO"} ===`);