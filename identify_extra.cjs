const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Extract section between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlists);
let sectionText = tomlContent.substring(firstAllowlists, firstRulesPos);

// Extract all '''...''' blocks using the test's regex
const re = /'''(.*?)'''/gs;
const configuredLines = [];
let m;
let blockNum = 0;
while ((m = re.exec(sectionText)) !== null) {
  blockNum++;
  configuredLines.push({ num: blockNum, content: m[1] });
}

console.log(`\nTotal blocks extracted: ${configuredLines.length}`);

// Show ALL blocks (first 20 and last few)
console.log("\n--- All block contents (first 30 chars each) ---");
for (let j = 0; j < configuredLines.length; j++) {
  const content30 = configuredLines[j].content.substring(0, 30);
  console.log(`Block ${j+1}: ${content30}`);

  // After showing 20, show last few
  if (j === 19) {
    console.log("  ...");
  }
  if (j >= configuredLines.length - 3 && j > 19) {
    console.log(`  Block ${j+1}: ${content30}`);
  }
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

// Check if block 85 is the extra one
if (configuredLines.length > expectedEntries.length) {
  const extraBlock = configuredLines[expectedEntries.length];
  console.log(`\n--- Extra block (block #${configuredLines.length}) ---`);
  console.log(`Content (first 80): ${JSON.stringify(extraBlock.content).substring(0, 80)}`);

  // Check if this extra block content appears anywhere in the expected entries
  const foundInExpected = expectedEntries.some(e => e === extraBlock.content);
  console.log(`Found in expected entries: ${foundInExpected}`);

  // Check if it's a duplicate of an earlier block
  const isDuplicate = configuredLines.slice(0, expectedEntries.length).some(e => e.content === extraBlock.content);
  console.log(`Is duplicate of earlier block: ${isDuplicate}`);
}