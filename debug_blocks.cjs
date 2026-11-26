const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Extract expected entries from mjs
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

// Find blocks between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlights || firstAllowlists);

console.log(`First [[allowlists]] at: ${firstAllowlists}`);
console.log(`First [[rules]] at: ${firstRules}`);

let sectionText = tomlContent.substring(firstAllowlights, firstRulesPos);

// Find all '''...''' blocks within this section
const sectionBlocks = [];
const sectionRe = /'''(.*?)'''/gs;
let sectionMatch;
while ((sectionMatch = sectionRe.exec(sectionText)) !== null) {
  sectionBlocks.push({
    content: sectionMatch[1],
    start: sectionMatch.index,
    end: sectionMatch.index + sectionMatch[0].length
  });
}

console.log(`\nBlocks between first [[allowlists]] and first [[rules]]: ${sectionBlocks.length}`);
console.log(`Expected entries: ${expectedEntries.length}`);

// Show last few blocks
console.log("\n--- Last 10 section block contents ---");
for (let j = Math.max(0, sectionBlocks.length - 10); j < sectionBlocks.length; j++) {
  console.log(`\nBlock ${j+1}: ${JSON.stringify(sectionBlocks[j].content).substring(0, 80)}`);
}

// Check current TOML blocks
let currentToml = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const currentRe = /'''(.*?)'''/gs;
const currentBlocks = [];
let cm;
while ((cm = currentRe.exec(currentToml)) !== null) {
  currentBlocks.push(cm[1]);
}

console.log(`\nCurrent TOML has ${currentBlocks.length} blocks in entire file`);

// Show section blocks from current TOML
let currSection = currentToml.substring(firstAllowlists, firstRules);
const currSectionBlocks = [];
const currSectionRe = /'''(.*?)'''/gs;
let csm;
while ((csm = currSectionRe.exec(currSection)) !== null) {
  currSectionBlocks.push({ content: csm[1], start: csm.index });
}

console.log(`\nSection has ${currSectionBlocks.length} blocks`);

// Compare expected vs current section blocks (first 20)
console.log("\n--- Comparing expected entries with current section blocks (first 20) ---");
let mismatches = 0;
for (let j = 0; j < Math.min(20, expectedEntries.length); j++) {
  const expected = expectedEntries[j];
  const actual = currSectionBlocks[j] ? currSectionBlocks[j].content : "MISSING";

  if (j >= currSectionBlocks.length) {
    console.log(`\nEntry ${j+1}: MISSING from section`);
    mismatches++;
    continue;
  }

  if (expected !== actual) {
    console.log(`\nEntry ${j+1}: MISMATCH`);
    console.log(`  Expected (first 40): ${JSON.stringify(expected).substring(0, 40)}`);
    console.log(`  Actual (first 40):   ${JSON.stringify(actual).substring(0, 40)}`);
    mismatches++;
  }
}

console.log(`\nFirst 20 mismatches: ${mismatches}`);

// Check for duplicate content
console.log("\n--- Checking for duplicate block contents ---");
const contentCounts = {};
for (const cb of currSectionBlocks) {
  const key = cb.content;
  contentCounts[key] = (contentCounts[key] || 0) + 1;
}

let duplicates = 0;
for (const [key, count] of Object.entries(contentCounts)) {
  if (count > 1) {
    duplicates++;
    console.log(`  Duplicate content (${count} times): ${JSON.stringify(key).substring(0, 50)}`);
  }
}
console.log(`Total duplicate content groups: ${duplicates}`);

// Check the extra block
if (currSectionBlocks.length > expectedEntries.length) {
  const extraBlock = currSectionBlocks[expectedEntries.length];
  console.log(`\n--- Extra block (index ${expectedEntries.length}) ---`);
  console.log(`Content: ${JSON.stringify(extraBlock.content).substring(0, 100)}`);

  const foundInExpected = expectedEntries.some(e => e === extraBlock.content);
  console.log(`Found in expected entries: ${foundInExpected}`);
}