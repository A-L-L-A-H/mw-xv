const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Step 1: Extract expected entries from mjs
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

// Step 2: Find blocks between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists);

console.log(`First [[allowlists]] at: ${firstAllowlists}`);
console.log(`First [[rules]] at: ${firstRules}`);

// Extract the section between first [[allowlists]] and first [[rules]]
let sectionText = tomlContent.substring(firstAllowlists, firstRules);

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

// Step 3: Compare and fix
// The test compares configuredLines[index] === expectedLines[index]
// So I need block content at position index to equal expectedEntries[index]

// Fix: replace each '''<actual>''' with '''<expected>'''
// Process from last to first so positions don't shift

let fixedCount = 0;

for (let entryIdx = expectedEntries.length - 1; entryIdx >= 0; entryIdx--) {
  const expected = expectedEntries[entryIdx];
  const actual = entryIdx < sectionBlocks.length ? sectionBlocks[entryIdx].content : null;

  if (entryIdx >= sectionBlocks.length) {
    console.log(`\nEntry ${entryIdx+1}: MISSING - would need to add new block`);
    continue;
  }

  if (expected !== actual) {
    // Replace the '''...''' block at position entryIdx with the expected content
    // The block pattern is '''<actual>''' where actual is the current content
    // I need to replace it with '''<expected>'''

    // Escape regex special chars in actual for the pattern match
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockPattern = new RegExp("'''" + escapedActual + "'''", '');

    const blockMatch = sectionText.match(blockPattern);
    if (blockMatch) {
      // Replace in the section text
      const newBlock = "'''" + expected + "'''";
      sectionText = sectionText.replace(blockPattern, newBlock);
      fixedCount++;
      console.log(`Fixed entry ${entryIdx+1}`);
    } else {
      console.log(`\nEntry ${entryIdx+1}: Could not find block pattern. Actual: ${JSON.stringify(actual).substring(0, 40)}`);
    }
  }
}

// Now rebuild the full TOML
const newToml = tomlContent.substring(0, firstAllowlists) + sectionText + tomlContent.substring(firstRules);

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