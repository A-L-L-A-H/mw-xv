const fs = require("fs");

// Read the mjs file and extract expectedAllowlistExpressions entries
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Find the array
const idx = mjsContent.indexOf("expectedAllowlistExpressions");
const afterIdx = mjsContent.indexOf("= [", idx) + 2;
const arrayEnd = mjsContent.indexOf("] [", afterIdx);
const arraySection = mjsContent.substring(afterIdx, arrayEnd);

// Extract all quoted string entries from the array
const expectedEntries = [];
let i = 0;
while (i < arraySection.length) {
  while (i < arraySection.length && /[\\s\\n]/.test(arraySection[i])) i++;
  if (i >= arraySection.length) break;
  if (arraySection[i] === '"') {
    i++; // skip opening quote
    let entry = "";
    while (i < arraySection.length) {
      if (arraySection[i] === '\\' && i + 1 < arraySection.length) {
        entry += arraySection[i] + arraySection[i+1];
        i += 2;
      } else if (arraySection[i] === '"') {
        expectedEntries.push(entry);
        i++; // skip closing quote
        break;
      } else {
        entry += arraySection[i];
        i++;
      }
    }
  } else { i++; }
}

// Read the TOML file
let tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find the first [[allowlists]] section and its regexes
// The first [[allowlists]] is at the start of the file
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
// Find the [[rules]] that follows
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists);
// Find the second [[allowlists]] (starts section 2)
const secondAllowlists = tomlContent.indexOf("[[allowlists]]", firstAllowlists + "[[allowlists]]".length);

// The first section is from firstAllowlists to secondAllowlights
let section1 = tomlContent.substring(firstAllowlists, secondAllowlights);

// Within section1, find the regexes = [ and the content
const regexesMarker = "regexes = [";
const rStart = section1.indexOf(regexesMarker);
// Find where the regexes array ends - it ends before the next description = " or [[allowlists]]
const section1Lines = section1.split('\n');
let regexesEndLine = -1;
for (let li = rStart; li < section1Lines.length; li++) {
  const line = section1Lines[li].trim();
  if (line.startsWith('description') || line.startsWith('[[allowlists]') || line.startsWith('[[rules]]')) {
    regexesEndLine = li;
    break;
  }
}
if (regexesEndLine === -1) {
  for (let li = rStart; li < section1Lines.length; li++) {
    if (section1Lines[li].trim() === ']') {
      regexesEndLine = li;
      break;
    }
  }
}

if (regexesEndLine === -1) {
  console.log("Could not find end of regexes array");
  process.exit(1);
}

// Extract current blocks from this section
const re = /'''(.*?)'''/gs;
const currentBlocks = [];
let m;
while ((m = re.exec(section1)) !== null) {
  currentBlocks.push(m[1]);
}

console.log("Current blocks in section 1:", currentBlocks.length);
console.log("Expected entries:", expectedEntries.length);

// For each expected entry, replace the block content
for (let entryIdx = 0; entryIdx < expectedEntries.length; entryIdx++) {
  const expected = expectedEntries[entryIdx];
  const actual = currentBlocks[entryIdx] || "";

  if (entryIdx >= currentBlocks.length) {
    console.log(`Entry ${entryIdx+1}: MISSING from TOML section 1`);
    continue;
  }

  if (expected !== actual) {
    // Replace the block content
    // Current: '''<actual>'''
    // New: '''<expected>'''

    // Escape regex special chars in actual
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRegex = new RegExp("'''" + escapedActual + "'''", '');

    const blockMatch = section1.match(blockRegex);
    if (blockMatch) {
      // Build new block: '''<expected>'''
      const newBlock = "'''" + expected + "'''";

      section1 = section1.replace(blockRegex, newBlock);
      console.log(`Fixed entry ${entryIdx+1}`);
    } else {
      console.log(`WARNING: Could not find block for entry ${entryIdx+1}`);
      console.log(`  Looking for pattern with actual: ${JSON.stringify(actual).substring(0, 40)}`);
    }
  }
}

// Now rebuild the full TOML
// Replace section1 in the full TOML
const newToml = tomlContent.substring(0, firstAllowlists) + section1 + tomlContent.substring(secondAllowlists);

// Write the updated TOML
fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newToml);
console.log("\nTOML file updated. Running test to verify...");

// Run the test
try {
  const { execSync } = require("child_process");
  const output = execSync("bun run test:secrets 2>&1", { cwd: "Z:/repo/mw-xv", timeout: 30000 });
  console.log("Test passed!");
  console.log(output.toString());
} catch (e) {
  console.log("Test output:");
  console.log(e.stdout.toString().substring(0, 3000));
}