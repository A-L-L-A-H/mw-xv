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

// Extract all '''...''' blocks from the first [[allowlists]] section
// (between [[allowlists]] and [[rules]])
const firstAllowlistsIdx = tomlContent.indexOf("[[allowlists]]");
const section2Idx = tomlContent.indexOf("[[allowlists]]", firstAllowlistsIdx + "[[allowlists]]".length);
let allowlistSection = tomlContent.substring(firstAllowlistsIdx, section2Idx);

const re = /'''(.*?)'''/gs;
const currentBlocks = [];
let m;
while ((m = re.exec(allowlistSection)) !== null) {
  currentBlocks.push(m[1]);
}

// Now, for each entry, replace the '''...''' block content to match the expected entry
// The strategy: find each '''...''' block in the allowlistSection, and replace its content
// with the expected entry string

// For each entry, replace the content between ''' markers
for (let entryIdx = 0; entryIdx < expectedEntries.length; entryIdx++) {
  const expected = expectedEntries[entryIdx];
  const actual = currentBlocks[entryIdx] || "";

  if (entryIdx >= currentBlocks.length) {
    console.log(`Entry ${entryIdx+1}: MISSING from TOML - would need to add`);
    continue;
  }

  if (expected !== actual) {
    // Need to replace this block's content
    // The current block is: '''<actual>'''
    // I need to replace it with: '''<expected>'''

    // Escape any single quotes in the expected content by using ''''' pattern
    // In TOML ''''' is an escaped single quote inside triple quotes
    // Actually, let me just replace the content between the existing ''' ''' markers

    // Find the exact block pattern '''<actual>''' in the allowlistSection
    // and replace with '''<expected>'''

    // Escape regex special chars in actual
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRegex = new RegExp("'''" + escapedActual + "'''", '');

    const blockMatch = allowlistSection.match(blockRegex);
    if (blockMatch) {
      // Replace the block content
      // Build new block: '''<expected>'''
      // Need to escape single quotes in expected for TOML
      // In TOML, inside '''''...''''', a single quote is written as ''''' (5 quotes = 3 open + 1 escaped + 3 close... hmm actually)
      // Actually, in TOML, '''...</''' is a raw string. To include a single quote, you just write it.
      // But ''' itself would end the string. So if the expected content contains ''', that's a problem.
      // Let me check if any expected entry contains '''

      let escapedExpected = expected;
      // Replace ''' with ''''' (5 single quotes = escaped single quote + triple quotes)
      // Actually in TOML, ''' is just the start/end marker. Inside, a single quote is just '
      // But if we need to represent a literal ''', it gets complicated.
      // Let me just check if expected contains '''
      if (expected.includes("'''")) {
        console.log(`Entry ${entryIdx+1} contains triple-single-quote, need special handling`);
      }

      // For now, just replace directly - the actual content shouldn't contain ''' since we checked
      const newBlock = "'''" + escapedExpected + "'''";
      allowlistSection = allowlistSection.replace(blockRegex, newBlock);
      console.log(`Fixed entry ${entryIdx+1}`);
    } else {
      console.log(`WARNING: Could not find block for entry ${entryIdx+1}`);
      console.log(`  Expected: ${JSON.stringify(expected).substring(0, 60)}`);
      console.log(`  Actual:   ${JSON.stringify(actual).substring(0, 60)}`);
    }
  }
}

// Now rebuild the full TOML
const newToml = tomlContent.substring(0, firstAllowlistsIdx) + allowlistSection + tomlContent.substring(section2Idx);

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