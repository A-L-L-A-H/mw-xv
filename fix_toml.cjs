const fs = require("fs");

// Read the mjs file and extract expectedAllowlistExpressions
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Find the array
const idx = mjsContent.indexOf("expectedAllowlistExpressions");
const afterEq = mjsContent.indexOf("= [", idx) + 2;
// Find the closing ][ for coolifyTemplateAllowlist
const nextArray = mjsContent.indexOf(" = [", afterEq);
const arrayText = mjsContent.substring(afterEq, nextArray);

// Extract all quoted string entries from the array
const entries = [];
let i = 0;
while (i < arrayText.length) {
  while (i < arrayText.length && /[\\s\\n]/.test(arrayText[i])) i++;
  if (i >= arrayText.length) break;
  if (arrayText[i] === '"') {
    i++; // skip opening quote
    let entry = "";
    while (i < arrayText.length) {
      if (arrayText[i] === '\\' && i + 1 < arrayText.length) {
        // Keep the escape sequence as-is; we want the raw characters
        entry += arrayText[i] + arrayText[i+1];
        i += 2;
      } else if (arrayText[i] === '"') {
        entries.push(entry);
        i++; // skip closing quote
        break;
      } else {
        entry += arrayText[i];
        i++;
      }
    }
  } else { i++; }
}

// Now read the TOML and extract the current blocks
const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const allowlistsStart = tomlContent.indexOf("[[allowlists]]");
const rulesStart = tomlContent.indexOf("[[rules]]", allowlistsStart);
const allowlistSection = tomlContent.substring(allowlistsStart, rulesStart);

const currentBlocks = [];
const re = /'''(.*?)'''/gs;
let m;
while ((m = re.exec(allowlistSection)) !== null) {
  currentBlocks.push(m[1]);
}

// For each entry, we need the TOML '''' block content to match the expected entry
// The extraction regex /'''(.*?)'''/gs captures the raw text between triple quotes
// So we need the TOML file to have the expected entry's actual string content between '''

// The expected entries from the mjs file are JS strings. Their actual content depends on
// JS escape processing. For example, \" in JS source = literal " in the string value.
// And \\ in JS source = literal \ in the string value.

// Let me just use the entries as-is. The entries array already has the actual string values
// (since I parsed them by reading the JS source characters).

// Now, to write the TOML, I need to put each expected entry between '''' markers.
// But I need to be careful: the TOML file uses '''' as delimiters, and the content
// between them is raw text. So I just need to write the expected entry string content
// between '''' in the TOML file.

// However, the TOML file might interpret backslashes or quotes differently.
// Let me just try writing the content directly and see.

// Build the new TOML content
// The structure is: [[allowlists]] ... [[rules]]
// Between them, we have multiple [[allowlists]] sections, each with description, regexTarget, paths, regexes
// The first few [[allowlists]] sections have regexes with '''...''' blocks

// Actually, looking at the TOML structure, the '''...''' blocks are within the regexes array
// of the first [[allowlists]] section (the one with description about "Exact synthetic fixtures...")

// Let me re-read the TOML structure more carefully

// From the read output, the TOML has multiple [[allowlists]] sections:
// - Section 1 (lines 6-95): description "Exact synthetic fixtures...", regexTarget "line", has regexes with '''...'''
// - Section 2 (lines 97-109): description "orm-observability...", regexTarget "match"
// - Section 3 (lines 111-113): description "Pinned third-party...", paths only
// - etc.

// The '''...''' blocks are only in section 1's regexes array!

// Let me identify which '''...''' blocks need to change. They're in the first section's regexes.

// Let me just replace the entire first section's regexes with the correct expected entries

// Actually, let me take a different approach. Let me just regenerate the entire TOML file
// based on the expected expressions.

// First, let me understand the TOML structure better by reading specific parts

console.log("Expected entries count:", entries.length);
console.log("Current blocks count:", currentBlocks.length);

// Let me just print the first few expected entries to understand the format
for (let j = 0; j < Math.min(5, entries.length); j++) {
  console.log("\nExpected entry " + (j+1) + " (JS string): " + JSON.stringify(entries[j]));
  console.log("  Length:", entries[j].length);
  // Print first 20 chars
  console.log("  First 20 chars:", entries[j].substring(0, 20));
}

// Now I need to write the TOML with the correct blocks.
// The tricky part is that the TOML file structure has the '''...''' blocks
// within a specific section. Let me just rebuild the whole file.

// Actually, a simpler approach: let me just modify the first section's regexes
// to match the expected entries, and leave the rest of the file unchanged.

// The first [[allowlists]] section starts at allowlistsStart and ends at rulesStart.
// Its regexes are extracted by the test using /'''(.*?)'''/gs.

// Let me just rebuild the regexes part of the first section.

// The current regexes in the TOML are between regexes = [ and the next ] or [[
// Let me find where the first section's regexes end

// From the read output, section 1 has regexes from line 10 to line 95,
// and then [[allowlists]] section 2 starts at line 97.

// Let me find the exact boundaries in the raw text.

// Actually, let me just take the pragmatic approach: I'll write a new TOML file
// where the first section's regexes array contains the correct '''...''' blocks.

// I need to format each expected entry as '''content''' where content is the
// expected entry string. But I need to make sure the ''' doesn't appear in the content.
// Looking at the expected entries, none of them seem to contain ''' (triple single quote),
// so that should be fine.

// For the TOML file, I'll write each entry as:
// '''<expected entry content>'''

// The expected entry content is the actual string value from the mjs file.
// Since I parsed the entries by reading the JS source, the entries array contains
// the actual string values (with backslashes as actual characters).

// Let me verify this by checking entry 1
console.log("\n\nVerifying entry parsing:");
console.log("Entry 1 length:", entries[0].length);
console.log("Entry 1 first 30:", entries[0].substring(0, 30));
console.log("Entry 1 last 30:", entries[0].substring(entries[0].length - 30));

// Now let me build the new TOML content
// I'll reconstruct the first section with the correct regexes

// Read the full TOML
let newTmlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Find the first [[allowlists]] section and its regexes
// The first [[allowlists]] starts at the first occurrence of "[[allowlists]]"
const firstAllowlistsIdx = newTmlContent.indexOf("[[allowlists]]");
// Find the [[rules]] that follows it
const firstRulesIdx = newTmlContent.indexOf("[[rules]]", firstAllowlistsIdx);

// The section between firstAllowlistsIdx and firstRulesIdx is the first allowlists section
const section1 = newTmlContent.substring(firstAllowlistsIdx, firstRulesIdx);

// Within section1, find the regexes = [ and the closing ]
const regexesStartIdx = section1.indexOf("regexes = [");
if (regexesStartIdx === -1) {
  console.log("Could not find regexes = [ in section 1");
  process.exit(1);
}

// Find the closing ] for regexes
// It could be followed by \n  or by [[allowlists]] or by [[rules]]
let regexesEndIdx = section1.indexOf("]", regexesStartIdx + "regexes = [".length);
// Check if there's a \n after the ]
const afterBracket = section1.substring(regexesEndIdx, regexesEndIdx + 2);
if (afterBracket.trim() === "") {
  // Just ]
} else {
  // Might be ] followed by other stuff
}

// Actually, let me just find the regexes section by looking for the pattern
// The regexes array contains '''...''' blocks, and the section ends before the next [[allowlists]]

// Let me find where section 2 starts within the full TOML
const section2Idx = newTmlContent.indexOf("[[allowlists]]", firstAllowlistsIdx + "[[allowlists]]".length);

// Section 1 is from firstAllowlistsIdx to section2Idx
const section1Text = newTmlContent.substring(firstAllowlistsIdx, section2Idx);

// Now find regexes = [ within section1Text
const rStart = section1Text.indexOf("regexes = [");
if (rStart === -1) {
  console.log("Could not find regexes in section 1");
  process.exit(1);
}

// Find the end of the regexes array - it ends before the description line of the next section
// or before [[allowlists]] or before [[rules]]
// Let me find the closing ] by counting brackets or just using a regex approach

// Actually, the simplest way: the regexes array contains entries with '''...''',
// and the array ends before the next description = " or [[allowlists]]

// Let me just find where the regexes array ends by looking for the pattern
// After regexes = [, the content is the array, and it ends when we hit
// a line that starts with something like "description = " or [[allowlists]]

// Let me just split by newlines and find the end
const section1Lines = section1Text.split('\n');
let regexesEndLine = -1;
for (let li = rStart; li < section1Lines.length; li++) {
  const line = section1Lines[li].trim();
  if (line.startsWith('description') || line.startsWith('[[allowlists]') || line.startsWith('[[rules]]')) {
    regexesEndLine = li;
    break;
  }
}

// If not found, use the ] after regexes =
if (regexesEndLine === -1) {
  // Find the ] that closes regexes
  // It should be on a line by itself or followed by description
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

// The regexes content is from rStart to regexesEndLine
const regexesContent = section1Text.substring(rStart, regexesEndLine);

// Now I need to replace the regexes content with the new entries
// Each new entry should be: '<expected entry>' (as a JS string, but written as raw text in TOML)
// Wait, the entries from my parsing are JS string values. I need to write them as raw text
// in the TOML file.

// Let me think about this differently. The test extracts /'''(.*?)'''/gs from the TOML
// between [[allowlists]] and [[rules]]. The captured text becomes a JS string.
// The test then compares this JS string against the expectedAllowlistExpressions array entries,
// which are also JS strings.

// So I need the extracted JS string to equal the expected JS string.

// The extracted JS string is the raw text between '''' markers in the TOML.
// The expected JS string is what's in the mjs array.

// If I write '''<raw text>''' in the TOML file, the extracted string is <raw text> (literally).
// So I need <raw text> to equal the expected JS string's actual value.

// The entries array I built contains the actual JS string values (with backslash characters
// as actual \ characters, etc.).

// So for each entry, I should write '''<entry>''' in the TOML file, where <entry> is the
// entry string value. But I need to make sure the ''' doesn't appear in the entry content.

// Let me check if any entry contains '''
for (let j = 0; j < entries.length; j++) {
  if (entries[j].includes("'''")) {
    console.log("Entry " + (j+1) + " contains '''");
  }
}
console.log("No entries contain ''' - good");

// Now let me build the new regexes content
// Each entry should be formatted as: '''<entry content>'''

// But wait - the TOML file currently has the regexes entries formatted differently.
// Some have ''' at the start and end, some have different patterns.
// Let me look at the current format more carefully.

// From the earlier extraction, the current blocks are like:
// "^\\s*\"tokensSha256\": \"269a6e0..."  (without the ''' markers, just the raw text)

// And the test extracts using /'''(.*?)'''/gs, which means the TOML file has the content
// between ''' markers. So the TOML file has something like:
// '''^\\s*"tokensSha256": "269a6e0..."'''

// So to replace, I need to put the new content between ''' markers.

// Let me build the new regexes array for the TOML.
// I'll format each entry as: '''<entry content>'''

// But I need to escape any ''' that might appear in the entry content.
// From my check, no entries contain ''', so that's fine.

// Also, I need to be careful about backslashes and quotes in the TOML file content.
// Since the TOML file is just read as raw text, backslashes and quotes are just characters.

// Let me build the new regexes array string:
let newRegexes = "regexes = [\n";
for (let j = 0; j < entries.length; j++) {
  // Each entry is written as '''...''' in the TOML
  // The entry content might contain " characters, which is fine in TOML '''''...'''
  // But I need to make sure the '''' markers are balanced

  const entry = entries[j];
  // Add the ''' wrapper
  newRegexes += `  '''${entry}''',\n`;
}
newRegexes += "]\n";

// Now replace the regexes content in section1Text
const newSection1 = section1Text.substring(0, rStart) + newRegexes + section1Text.substring(regexesEndLine + 1);

// Replace section1 in the full TOML
newTmlContent = newTmlContent.substring(0, firstAllowlistsIdx) + newSection1 + newTmlContent.substring(section2Idx);

console.log("\nNew TOML generated. Writing file...");

// Write the new TOML file
fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newTmlContent);
console.log("TOML file written successfully");

// Now let me verify by running the test
console.log("\nRunning test:secrets to verify...");