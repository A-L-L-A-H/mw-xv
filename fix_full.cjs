const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find all '''...''' blocks and their positions in the entire TOML
const re = /'''(.*?)'''/gs;
const allBlocks = [];
let m;
let blockNum = 0;
while ((m = re.exec(tomlContent)) !== null) {
  allBlocks.push({
    num: ++blockNum,
    content: m[1],
    start: m.index,
    end: m.index + m[0].length
  });
}

console.log(`Total '''...''' blocks in entire TOML: ${allBlocks.length}`);

// Find the first [[allowlists]] and [[rules]] positions
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists);

console.log(`First [[allowlists]] at position: ${firstAllowlists}`);
console.log(`First [[rules]] at position: ${firstRules}`);

// Extract the section between first [[allowlists]] and first [[rules]]
const sectionText = tomlContent.substring(firstAllowlists, firstRules);

// Find all '''...''' blocks within this section (the expected 84 blocks)
const sectionBlocks = [];
const sectionRe = /'''(.*?)'''/gs;
let sectionMatch;
let sectionOffset = 0;
while ((sectionMatch = sectionRe.exec(sectionText)) !== null) {
  // Adjust position to be relative to the full TOML
  sectionBlocks.push({
    content: sectionMatch[1],
    positionInSection: sectionMatch.index,
    positionInToml: sectionMatch.index + firstAllowlists
  });
}

console.log(`\nBlocks between first [[allowlists]] and first [[rules]]: ${sectionBlocks.length}`);

// Show first 30 blocks briefly
console.log("\n--- First 30 section block contents ---");
for (let i = 0; i < Math.min(30, sectionBlocks.length); i++) {
  console.log(`Block ${i+1}: ${JSON.stringify(sectionBlocks[i].content).substring(0, 80)}`);
}

// Now let's also extract expected entries from mjs
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

// Compare each expected entry with section blocks
console.log("\n--- Comparing expected entries with section blocks ---");
let allMatch = true;
for (let j = 0; j < expectedEntries.length; j++) {
  const expected = expectedEntries[j];
  const actual = sectionBlocks[j] ? sectionBlocks[j].content : "MISSING";

  if (j >= sectionBlocks.length) {
    console.log(`\nEntry ${j+1}: MISSING from section blocks`);
    allMatch = false;
    continue;
  }

  if (expected !== actual) {
    // Check if the expected content appears in any section block
    let foundExact = false;
    for (const sb of sectionBlocks) {
      if (sb.content === expected) {
        foundExact = true;
        break;
      }
    }

    if (foundExact) {
      console.log(`\nEntry ${j+1}: Content mismatch but appears somewhere in section blocks`);
    } else {
      console.log(`\nEntry ${j+1}: MISMATCH`);
      console.log(`  Expected (first 50): ${JSON.stringify(expected).substring(0, 50)}`);
      console.log(`  Actual (first 50):   ${JSON.stringify(actual).substring(0, 50)}`);
      allMatch = false;
    }
  }
}

console.log(`\n=== All 84 entries match: ${allMatch ? "YES" : "NO"} ===`);

// Now, let's rebuild the TOML with correct block contents
// We need to replace each '''<actual>''' with '''<expected>'''
// But we need to be careful about ordering and duplicates

// Let's just try a simple approach: replace the regexes array content entirely
// First, let's find the regexes = [ section and the closing ]

// Find regexes = [ within the section
const regexesMarker = "regexes = [";
const rStart = sectionText.indexOf(regexesMarker);
console.log(`\nregexes = [ found at position within section: ${rStart}`);

if (rStart >= 0) {
  // Find the end - it ends before the next description = " or [[allowlists]] or before the end of section
  const sectionLines = sectionText.split('\n');
  let regexesEndLine = -1;
  for (let li = rStart; li < sectionLines.length; li++) {
    const line = sectionLines[li].trim();
    if (line.startsWith('description') || line.startsWith('[[allowlists]') || line.startsWith('[[rules]]')) {
      regexesEndLine = li;
      break;
    }
  }
  if (regexesEndLine === -1) {
    // Try finding ] on its own
    for (let li = rStart; li < sectionLines.length; li++) {
      if (sectionLines[li].trim() === ']') {
        regexesEndLine = li;
        break;
      }
    }
  }

  if (regexesEndLine >= 0) {
    console.log(`regexes ends at line ${regexesEndLine} within section`);

    // Build new regexes content
    // Each entry should be '''<expected entry>'''
    let newRegexes = "regexes = [\n";
    for (let j = 0; j < expectedEntries.length; j++) {
      const entry = expectedEntries[j];
      // In TOML, '''content''' means the content is raw text between the quotes
      // We need to make sure ''' doesn't appear in content (it shouldn't based on earlier check)
      newRegexes += `  '''${entry}''',\n`;
    }
    newRegexes += "]\n";

    // Replace the old regexes with new ones
    const oldRegexesContent = sectionText.substring(rStart, sectionText.indexOf('\n', regexesEndLine) + 1);
    const newSectionText = sectionText.substring(0, rStart) + newRegexes + sectionText.substring(sectionText.indexOf('\n', regexesEndLine) + 1);

    // Now rebuild the full TOML
    const newToml = tomlContent.substring(0, firstAllowlists) + newSectionText + tomlContent.substring(firstRules);

    console.log("\nNew TOML generated. Writing file...");

    fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newToml);
    console.log("TOML file written successfully");
  }
}