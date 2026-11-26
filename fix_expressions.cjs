const fs = require("fs");

// Read the mjs file and extract expectedAllowlistExpressions entries
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Find the expectedAllowlistExpressions array
const idx = mjsContent.indexOf("expectedAllowlistExpressions");
const afterEq = mjsContent.indexOf("= [", idx) + 2;
// Find the closing ][ for coolifyTemplateAllowlist
const nextArray = mjsContent.indexOf(" = [", afterEq);
const arrayText = mjsContent.substring(afterEq, nextArray);

// Extract all quoted string entries from the array
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
        // Keep the escape sequence as-is; we want the raw characters that represent the escape
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

// Read the TOML file
let tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find all '''...''' blocks and their positions
const re = /'''(.*?)'''/gs;
const currentBlocks = [];
let m;
const blockPositions = []; // {content, start, end}
while ((m = re.exec(tomlContent)) !== null) {
  currentBlocks.push(m[1]);
  blockPositions.push({ content: m[1], start: m.index, end: m.index + m[0].length });
}

console.log(`Current blocks from TOML: ${currentBlocks.length}`);
console.log(`Expected entries from mjs: ${expectedEntries.length}`);

// We need to fix the TOML so that the '''...''' block contents match the expected entries
// The test extracts using /'''(.*?)'''/gs and compares each captured content against expectedEntries[index]

// Strategy: For each expected entry, find the corresponding TOML block and replace its content
// A TOML block is '''<content>'''. We need to replace <content> with the expected entry.

// But we need to be careful: the same block content might appear multiple times, and we need
// to replace them in order.

// Let me first check: are there exactly 84 blocks?
if (currentBlocks.length !== 84) {
  console.log(`\nWARNING: Expected 84 blocks but found ${currentBlocks.length}`);
  console.log("Some entries may be missing or extra.");
}

// Fix each entry
let fixed = false;
for (let entryIdx = 0; entryIdx < expectedEntries.length; entryIdx++) {
  const expected = expectedEntries[entryIdx];
  const actual = currentBlocks[entryIdx] || "MISSING";

  if (entryIdx >= currentBlocks.length) {
    console.log(`\nEntry ${entryIdx+1}: MISSING from TOML - need to add`);
    continue;
  }

  if (expected !== actual) {
    // Need to fix this entry
    // Find the TOML block that contains 'actual' content and replace it

    // The block pattern is '''<actual>'''
    // But 'actual' might contain regex special characters, so escape them
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockPattern = new RegExp("'''" + escapedActual + "'''", '');

    const blockMatch = tomlContent.match(blockPattern);
    if (blockMatch) {
      // Replace the block content: '''<expected>'''
      const newBlockContent = "'''" + expected + "'''";
      tomlContent = tomlContent.replace(blockPattern, newBlockContent);
      console.log(`Fixed entry ${entryIdx+1}`);
      fixed = true;
    } else {
      console.log(`\nEntry ${entryIdx+1}: Could not find block to replace`);
      console.log(`  Expected (first 60): ${JSON.stringify(expected).substring(0, 60)}`);
      console.log(`  Actual (first 60):   ${JSON.stringify(actual).substring(0, 60)}`);
      console.log(`  Looking for pattern with actual: ${JSON.stringify(escapedActual).substring(0, 60)}`);
    }
  }
}

// After fixing all entries, verify by running the test
if (fixed) {
  fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", tomlContent);
  console.log("\nTOML file updated. Running test to verify...");

  try {
    const { execSync } = require("child_process");
    const output = execSync("bun run test:secrets 2>&1", { cwd: "Z:/repo/mw-xv", timeout: 30000 });
    console.log("Test passed!");
    console.log(output.toString());
  } catch (e) {
    console.log("Test output:");
    console.log(e.stdout.toString().substring(0, 3000));
  }
} else {
  console.log("\nNo fixes were applied.");
}