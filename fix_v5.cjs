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

// Step 2: Find the first [[allowlists]] section and its regexes = [ area
const firstAllowlists = tomlContent.indexOf("[[allowlists]]");
const firstRules = tomlContent.indexOf("[[rules]]", firstAllowlists || firstAllowlists);

// Actually use the correct variable reference
const firstRulesPos = tomlContent.indexOf("[[rules]]", firstAllowlists);

console.log(`First [[allowlists]] at: ${firstAllowlists}`);
console.log(`First [[rules]] at: ${firstRulesPos}`);

// Step 3: Find regexes = [ within the first allowlists section
// The section is from firstAllowlists to firstRulesPos
let sectionText = tomlContent.substring(firstAllowlists || firstAllowlists, firstRulesPos);

// Find regexes = [
const regexesMarker = "regexes = [";
const rStart = sectionText.indexOf(regexesMarker);

if (rStart >= 0) {
  // Find where the regexes array ends
  // It ends before the next description = " or [[allowlists]] or before the end of section
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
    // Try finding ] on its own line
    for (let li = rStart; li < sectionLines.length; li++) {
      if (sectionLines[li].trim() === ']') {
        regexesEndLine = li;
        break;
      }
    }
  }

  if (regexesEndLine >= 0) {
    // The old regexes content
    const oldRegexesStart = rStart;
    const oldRegexesEnd = sectionText.indexOf('\n', regexesEndLine) + 1;
    const oldRegexes = sectionText.substring(oldRegexesStart, oldRegexesEnd);

    // Build new regexes content with the 84 expected entries
    // Each entry formatted as '''<expected entry>'''
    let newRegexes = "regexes = [\n";
    for (let j = 0; j < expectedEntries.length; j++) {
      const entry = expectedEntries[j];
      // In TOML, '''content''' means the content is raw text between the triple quotes
      // The test extracts using /'''(.*?)'''/gs and compares against expected entries
      // We need to make sure the content between ''' ''' exactly matches the expected entry
      newRegexes += `  '''${entry}''',\n`;
    }
    newRegexes += "]\n";

    // Replace the old regexes with new ones
    const newSectionText = sectionText.substring(0, oldRegexesStart) + newRegexes + sectionText.substring(oldRegexesEnd);

    // Rebuild the full TOML
    const newToml = tomlContent.substring(0, firstAllowlists) + newSectionText + tomlContent.substring(firstRulesPos);

    console.log(`\nRebuilt TOML with ${expectedEntries.length} expected entries in regexes array`);
    console.log("Writing TOML file...");

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