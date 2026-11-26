const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find all '''...''' blocks and their positions
const re = /'''(.*?)'''/gs;
const blocks = [];
let m;
let blockNum = 0;
while ((m = re.exec(tomlContent)) !== null) {
  blocks.push({
    num: ++blockNum,
    content: m[1],
    start: m.index,
    end: m.index + m[0].length
  });
}

console.log(`Total '''...''' blocks in entire TOML: ${blocks.length}`);

// Find the first [[allowlists]] and [[rules]] positions
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists);

console.log(`\nFirst [[allowlists]] at position: ${firstAllowlists}`);
console.log(`First [[rules]] at position: ${firstRules}`);

// Extract the section between first [[allowlists]] and first [[rules]]
console.log(`\nBlocks between first [[allowlists]] and first [[rules]]: ${sectionBlocks.length}`);

// Find all '''...''' blocks within this section
const sectionBlocks = [];
const sectionRe = /'''(.*?)'''/gs;
let sectionMatch;
while ((sectionMatch = sectionRe.exec(sectionText)) !== null) {
  sectionBlocks.push({
    content: sectionMatch[1],
    start: sectionMatch.index,
    end: sectionMatch.index + sectionMatch[0].length,
    positionInSection: sectionMatch.index
  });
}

console.log(`\nBlocks between first [[allowlists]] and first [[rules]]: ${sectionBlocks.length}`);

for (let i = 0; i < Math.min(sectionBlocks.length, 30); i++) {
  console.log(`\nBlock ${i+1} (position ${sectionBlocks[i].positionInSection}):`);
  console.log(`  Content (first 80 chars): ${JSON.stringify(sectionBlocks[i].content).substring(0, 80)}`);
}

// Now let's also look at the expected entries and compare
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

// Compare: for each expected entry, find if it appears in the section blocks
console.log("\n--- Comparing first 10 expected entries with section blocks ---");
for (let j = 0; j < Math.min(10, expectedEntries.length); j++) {
  const expected = expectedEntries[j];
  console.log(`\nExpected entry ${j+1} (first 60): ${JSON.stringify(expected).substring(0, 60)}`);

  // Check if this appears in any section block
  let foundInSection = false;
  for (const sb of sectionBlocks) {
    if (sb.content === expected) {
      foundInSection = true;
      console.log(`  ✓ Found in section blocks at position ${sb.positionInSection}`);
      break;
    }
  }
  if (!foundInSection) {
    console.log(`  ✗ NOT found in section blocks`);
    // Check if it's close to any block
    for (const sb of sectionBlocks.slice(0, 5)) {
      if (sb.content.includes(expected.substring(0, 30)) || expected.includes(sb.content.substring(0, 30))) {
        console.log(`  ! Close to block ${sb.positionInSection}: content starts with ${JSON.stringify(sb.content.substring(0, 30))}`);
      }
    }
  }
}

// List all section block contents briefly
console.log("\n--- All section block contents (first 60 chars each) ---");
for (let i = 0; i < sectionBlocks.length; i++) {
  console.log(`Block ${i+1}: ${JSON.stringify(sectionBlocks[i].content).substring(0, 60)}`);
}