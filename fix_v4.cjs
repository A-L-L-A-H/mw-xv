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

console.log(`Expected entries: ${expectedEntries.length}`);

// Step 2: Find blocks between first [[allowlists]] and first [[rules]]
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists);

let sectionText = tomlContent.substring(firstAllowlists, firstRules);

// Split section into lines for precise editing
const sectionLines = sectionText.split('\n');

// Find all '''...''' blocks and their line numbers
// A ''' block starts on a line containing ''' and ends on a line containing '''
const blockStartLines = [];
const blockEndLines = [];

for (let li = 0; li < sectionLines.length; li++) {
  const line = sectionLines[li];
  const startMatches = line.match(/'{3}/g);
  const endMatches = line.match(/'{3}/g);

  if (startMatches) {
    const numStart = startMatches.length;
    for (let k = 0; k < numStart; k++) {
      blockStartLines.push({ line: li, count: numStart });
    }
  }
  if (endMatches) {
    const numEnd = endMatches.length;
    for (let k = 0; k < numEnd; k++) {
      blockEndLines.push({ line: li, count: numEnd });
    }
  }
}

console.log(`\nBlock start lines: ${blockStartLines.length}`);
console.log(`Block end lines: ${blockEndLines.length}`);

// Extract block contents by line positions
// Each '''...''' block spans from a start line to an end line
// The content is everything between the opening ''' and closing '''

// Let me identify the 84 blocks we need to fix
// The test extracts using /'''(.*?)'''/gs, which is greedy-minimal across lines

// Let me just identify all '''...</''' blocks and their content
const allBlocks = []; // {content, startLine, endLine, startPos, endPos}
let currentBlockContent = "";
let inBlock = false;
let blockStartLine = -1;

for (let li = 0; li < sectionLines.length; li++) {
  const line = sectionLines[li];

  if (line.includes("'''")) {
    const tripleQuoteCount = (line.match(/'{3}/g) || []).length;

    if (!inBlock) {
      // Starting a new block
      inBlock = true;
      blockStartLine = li;
      // Remove the leading ''' from the content
      const afterTriple = line.replace(/^'''/, '');
      currentBlockContent = afterTriple;
    } else {
      // Closing the block
      inBlock = false;
      // Remove the trailing ''' from the content
      const beforeTriple = currentBlockContent.replace(/'''$/, '');
      allBlocks.push({
        content: beforeTriple,
        startLine: blockStartLine,
        endLine: li
      });
      currentBlockContent = "";
    }
  } else if (inBlock) {
    currentBlockContent += line + "\n";
  }
}

// Remove trailing newline from last block content
for (const blk of allBlocks) {
  blk.content = blk.content.replace(/\n+$/, "");
}

console.log(`\nIdentified ${allBlocks.length} blocks in section`);

// Show first 10 blocks
console.log("\n--- First 10 block contents ---");
for (let j = 0; j < Math.min(10, allBlocks.length); j++) {
  console.log(`\nBlock ${j+1} (lines ${allBlocks[j].startLine+1}-${allBlocks[j].endLine+1}):`);
  console.log(`  Content (first 50): ${JSON.stringify(allBlocks[j].content).substring(0, 50)}`);
}

// Step 3: Fix each entry
// For each expected entry at position index, find the corresponding block and replace its content
// The blocks are in order, so block at position index should match expectedEntries[index]

let fixedCount = 0;

for (let entryIdx = 0; entryIdx < expectedEntries.length; entryIdx++) {
  const expected = expectedEntries[entryIdx];
  const actual = entryIdx < allBlocks.length ? allBlocks[entryIdx].content : "MISSING";

  if (entryIdx >= allBlocks.length) {
    console.log(`\nEntry ${entryIdx+1}: MISSING from TOML - need to add block at line ${sectionLines.length + 1}`);
    continue;
  }

  if (expected !== actual) {
    // Replace the block content at position entryIdx
    // The block is at allBlocks[entryIdx].startLine to allBlocks[entryIdx].endLine
    const block = allBlocks[entryIdx];
    const targetLineIndex = block.startLine;

    // Replace the content of the target line
    // The content between the opening ''' and closing ''' on that line
    // Actually, the block might span multiple lines, so I need to handle this carefully

    // Strategy: Replace the entire block's content in the sectionLines array
    // The block content currently is: allBlocks[entryIdx].content
    // I need to replace it with: expected

    // But the block might span multiple lines. Let me check if the content is on a single line
    const blockContentLines = sectionLines[targetLineIndex].split("'''");

    if (blockContentLines.length >= 3) {
      // The content is between the first and second ''' on the line
      // Replace just the content between the triple quotes
      const beforeQuotes = sectionLines[targetLineIndex].substring(0, sectionLines[targetIndex].indexOf("'''") + 3);
      // Hmm, this is getting complicated. Let me use a different approach.
    }

    // Actually, let me just rebuild the sectionText by replacing each '''...</''' pattern
    // using the exact content match, but being more careful about positioning

    // Find the '''...</''' block in sectionText using the exact current content
    // But escape properly
    const escapedActual = actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match ''' followed by content followed by ''', but we need to make sure it's the right position

    // Actually, let me try a simpler approach: just replace the content in the specific line
    // The TOML file has the format: '''<content>'''
    // And the test extracts using /'''(.*?)'''/gs

    // Let me just replace the content between the first ''' and the last ''' on the target line
    // But I need to know which line the block is on

    // Let me try yet another approach: replace the entire sectionText by rebuilding it
    // with all block contents replaced

    fixedCount++;
    console.log(`Fixed entry ${entryIdx+1}: content mismatch at block position ${entryIdx+1}`);
  }
}

// For now, let me just try the simple regex approach but with positional tracking
// I'll track which '''...</''' blocks I've already fixed and skip them

// Actually, the simplest approach: just rebuild the entire regexes array content
// by replacing each block's content in order

// Let me try a completely different strategy:
// 1. Extract the regexes = [ section
// 2. Build new regexes content with expected entries
// 3. Replace the old regexes with new ones

// Find regexes = [ within the section
const regexesMarker = "regexes = [";
const rStart = sectionText.indexOf(regexesMarker);

if (rStart >= 0) {
  // Find the end of regexes array - ends before description or next [[
  const sectionLines2 = sectionText.split('\n');
  let regexesEndLine = -1;
  for (let li = rStart; li < sectionLines2.length; li++) {
    const line = sectionLines2[li].trim();
    if (line.startsWith('description') || line.startsWith('[[allowlists]') || line.startsWith('[[rules]]')) {
      regexesEndLine = li;
      break;
    }
  }
  if (regexesEndLine === -1) {
    for (let li = rStart; li < sectionLines2.length; li++) {
      if (sectionLines2[li].trim() === ']') {
        regexesEndLine = li;
        break;
      }
    }
  }

  if (regexesEndLine >= 0) {
    // The regexes content is from rStart to regexesEndLine (inclusive)
    const oldRegexes = sectionText.substring(rStart, sectionText.indexOf('\n', regexesEndLine) + 1);

    // Build new regexes: each entry is '''<expected entry>'''
    let newRegexes = "regexes = [\n";
    for (let j = 0; j < expectedEntries.length; j++) {
      const entry = expectedEntries[j];
      // In TOML, '''content''' means the content is raw text between the quotes
      // We need to make sure ''' doesn't appear in content (it shouldn't)
      newRegexes += `  '''${entry}''',\n`;
    }
    newRegexes += "]\n";

    // Replace the old regexes with new ones in sectionText
    const newSectionText = sectionText.substring(0, rStart) + newRegexes + sectionText.substring(sectionText.indexOf('\n', regexesEndLine) + 1);

    // Rebuild full TOML
    const newToml = tomlContent.substring(0, firstAllowlights) + newSectionText + tomlContent.substring(firstRules);

    console.log(`\nRebuilt TOML with ${expectedEntries.length} expected entries in regexes array`);

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
  }
}