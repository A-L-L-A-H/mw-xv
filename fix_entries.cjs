const fs = require("fs");

// Read the mjs file and extract expectedAllowlistExpressions entries
// I'll use a simpler approach: just extract the raw expected strings

const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// The expectedAllowlistExpressions is an array of strings. Let me find it
// and extract each entry by finding the ^\s* patterns

// Actually, let me just use the test's own validation logic against the current TOML
// and fix based on the errors

// Let me re-read the current TOML and the test expectations, then fix entry by entry

// First, let me understand the format better by looking at a known-good comparison
// From the earlier comparison, the issue is that TOML has single-backslash escaping
// but expected has double-backslash.

// Let me just fix the TOML by replacing the entire first allowlists section's regexes

// Read the current TOML
let tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// I need to replace the regexes in the first [[allowlists]] section
// The first section has description "Exact synthetic fixtures..."
// and contains 84 '''...''' blocks in its regexes array

// Let me find the exact boundaries
const firstAllowlistsIdx = tomlContent.indexOf("[[allowlists]]");
const section2Idx = tomlContent.indexOf("[[allowlists]]", firstAllowlistsIdx + "[[allowlists]]".length);

// Section 1 is from firstAllowlistsIdx to section2Idx
const section1 = tomlContent.substring(firstAllowlistsIdx, section2Idx);

// Find regexes = [ within section1
const regexesMarker = "regexes = [";
const rStart = section1.indexOf(regexesMarker);
if (rStart === -1) {
  console.log("Could not find regexes = [ in section 1");
  process.exit(1);
}

// Find where the regexes array ends - it ends before the next description = " or [[allowlists]]
// Let me find the end by looking for lines after the array
const section1Lines = section1.split('\n');

// Find the line with the closing ] for regexes
// The regexes array entries end with , or ], and then the next line starts with description
let regexesEndIdx = -1;
for (let li = rStart; li < section1Lines.length; li++) {
  const line = section1Lines[li].trim();
  if (line.startsWith('description') || line.startsWith('[[allowlists]') || line.startsWith('[[rules]]')) {
    regexesEndIdx = li;
    break;
  }
}
// Also check if the ] is on its own line
if (regexesEndIdx === -1) {
  for (let li = rStart; li < section1Lines.length; li++) {
    if (section1Lines[li].trim() === ']') {
      regexesEndIdx = li;
      break;
    }
  }
}

if (regexesEndIdx === -1) {
  console.log("Could not find end of regexes array");
  console.log("Section 1 lines around regexes:");
  for (let li = rStart; li < rStart + 20; li++) {
    console.log("Line " + li + ":", JSON.stringify(section1Lines[li]));
  }
  process.exit(1);
}

const regexesContent = section1.substring(rStart, section1.indexOf('\n', regexesEndIdx) + 1);
const afterRegexes = section1.substring(section1.indexOf('\n', regexesEndIdx) + 1);

// Now I need to build new regexes content
// Each entry should be '''<expected entry content>'''

// But I need the expected entry content. Let me extract it differently.
// I'll use the test's own comparison: the test extracts /'''(.*?)'''/gs from TOML
// and compares against expectedAllowlistExpressions.

// The key insight from the comparison: the TOML blocks need their content changed
// to match the expected strings exactly.

// Let me just directly modify the TOML by editing each '''...''' block's content.
// I'll use a pattern-based approach.

// Actually, let me try a completely different approach:
// I'll write a Node script that reads the TOML, extracts all '''...''' blocks,
// compares each against the expected entry (which I'll also extract from the mjs file),
// and replaces mismatched blocks.

// First, let me extract the current blocks from TOML
const re = /'''(.*?)'''/gs;
const currentBlocks = [];
let m;
while ((m = re.exec(section1)) !== null) {
  currentBlocks.push(m[1]);
}

// Now extract expected entries from the mjs file
// I'll use the approach of finding all strings in the expectedAllowlistExpressions array
// The array starts after "expectedAllowlistExpressions = [" and ends before "] ["
const arrayStart = mjsContent.indexOf("expectedAllowlistExpressions") + "expectedAllowlistExpressions".length + 1;
const arrayEnd = mjsContent.indexOf("] [", arrayStart);
const arraySection = mjsContent.substring(arrayStart, arrayEnd);

// Extract quoted strings from the array section
const expectedEntries = [];
let j = 0;
while (j < arraySection.length) {
  while (j < arraySection.length && /[\\s\\n]/.test(arraySection[j])) j++;
  if (j >= arraySection.length) break;
  if (arraySection[j] === '"') {
    j++; // skip opening quote
    let entry = "";
    while (j < arraySection.length) {
      if (arraySection[j] === '\\' && j + 1 < arraySection.length) {
        entry += arraySection[j] + arraySection[j+1];
        j += 2;
      } else if (arraySection[j] === '"') {
        expectedEntries.push(entry);
        j++; // skip closing quote
        break;
      } else {
        entry += arraySection[j];
        j++;
      }
    }
  } else { j++; }
}

console.log("Current blocks from TOML:", currentBlocks.length);
console.log("Expected entries from mjs:", expectedEntries.length);

// Now compare and fix
for (let i = 0; i < expectedEntries.length; i++) {
  const expected = expectedEntries[i];
  const actual = currentBlocks[i] || "MISSING";

  if (i >= currentBlocks.length) {
    console.log(`\nEntry ${i+1}: MISSING from TOML - need to add`);
    continue;
  }

  if (expected !== actual) {
    // Need to fix this entry
    // The fix is to replace the '''...''' block content in the TOML
    // with the expected entry content

    // Find the current '''...''' block in the TOML section1 and replace its content
    // The block is: '''<current content>'''
    // I need to replace it with: '''<expected content>'''

    // First, find the exact position of this block in section1
    // The regex /'''(.*?)'''/gs already extracted it, but I need the string position

    // Let me find the block by searching for the pattern
    const blockPattern = new RegExp("'''" + actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'''", '');
    const blockMatch = section1.match(blockPattern);

    if (blockMatch) {
      // Replace the block content
      const newBlock = "'''" + expected.replace("'''", "\\\\'\\\\'\\\\'") + "'''";
      section1 = section1.replace(blockPattern, newBlock);
      console.log(`Fixed entry ${i+1}: replaced block content`);
    } else {
      console.log(`\nEntry ${i+1}: Could not find block to replace. Current: ${JSON.stringify(actual)}`);
      console.log("  Looking for pattern:", JSON.stringify(blockPattern));
    }
  }
}

// Now rebuild the full TOML
const newToml = tomlContent.substring(0, firstAllowlistsIdx) + section1 + tomlContent.substring(section2Idx);

fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newToml);
console.log("\nTOML file updated. Running test to verify...");

// Run the test
const { execSync } = require("child_process");
try {
  execSync("bun run test:secrets 2>&1", { cwd: "Z:/repo/mw-xv", timeout: 30000 });
  console.log("Test passed!");
} catch (e) {
  console.log("Test output:", e.stdout.toString().substring(0, 2000));
}