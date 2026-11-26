const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Step 1: Extract expected entries from mjs (the 84 entries)
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

console.log(`Expected entries: ${expectedEntries.length}`);

// Step 2: Extract '''...''' blocks from between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists || firstAllowlists);
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlists);

let sectionText = tomlContent.substring(firstAllowlists, firstRulesPos);

// Find all '''...''' blocks within this section
const sectionBlocks = []; // {content, start, end}
const sectionRe = /'''(.*?)'''/gs;
let sectionMatch;
while ((sectionMatch = sectionRe.exec(sectionText)) !== null) {
  sectionBlocks.push({
    content: sectionMatch[1],
    start: sectionMatch.index,
    end: sectionMatch.index + sectionMatch[0].length,
    position: sectionBlocks.length + 1 // 1-based for display
  });
}

console.log(`Blocks in section: ${sectionBlocks.length}`);

// Step 3: Fix each entry
// The test compares: configuredLines[index] === expectedLines[index]
// where configuredLines are extracted from TOML blocks in order
// So block at position index (0-based) must have content equal to expectedEntries[index]

// Process entries from 0 to 83 (all 84 expected entries)
let fixedCount = 0;

for (let entryIdx = 0; entryIdx < expectedEntries.length; entryIdx++) {
  const expected = expectedEntries[entryIdx];
  const actual = entryIdx < sectionBlocks.length ? sectionBlocks[entryIdx].content : "MISSING";

  if (entryIdx >= sectionBlocks.length) {
    console.log(`\nEntry ${entryIdx+1}: MISSING from TOML - need to add block`);
    continue;
  }

  if (expected !== actual) {
    // Replace the '''...''' block content
    // The block pattern is '''<actual>'''
    // I need to replace it with '''<expected>'''

    // Escape regex special chars in actual content for pattern matching
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockPattern = new RegExp("'''" + escapedActual + "'''", '');

    const blockMatch = sectionText.match(blockPattern);
    if (blockMatch) {
      // Replace in section text
      const newBlock = "'''" + expected + "'''";
      sectionText = sectionText.replace(blockPattern, newBlock);
      fixedCount++;
      console.log(`Fixed entry ${entryIdx+1}: replaced block content`);
    } else {
      console.log(`\nEntry ${entryIdx+1}: Could not find block pattern. Actual first 40: ${JSON.stringify(actual).substring(0, 40)}`);
    }
  }
}

// Step 4: After fixing, check if there are extra blocks (>84) and remove/delete them
// or if there are fewer than 84, we need to add blocks

// Check current block count
const currentBlockCount = (sectionText.match(/'''(.*?)'''/gs) || []).length;
console.log(`\nBlock count after fixes: ${currentBlockCount} (expected: ${expectedEntries.length})`);

// Step 5: Rebuild the full TOML
const newToml = tomlContent.substring(0, firstAllowlists) + sectionText + tomlContent.substring(firstRulesPos);

console.log(`\n${fixedCount} entries fixed. Writing TOML...`);

try {
  fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newToml);
  console.log("TOML file written successfully");

  // Run the test
  console.log("\nRunning test:secrets to verify...");
  const { execSync } = require("child_process");
  const output = execSync("bun run test:secrets 2>&1", { cwd: "Z:/repo/mw-xv", timeout: 30000 });
  console.log("Test passed!");
  console.log(output.toString());
} catch (e) {
  console.log("Test output:");
  console.log(e.stdout.toString().substring(0, 3000));
}