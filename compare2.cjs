const fs = require("fs");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Extract the expectedAllowlistExpressions array
var idx = mjsContent.indexOf("export const expectedAllowlistExpressions");
var afterEq = mjsContent.indexOf("= [", idx) + 2;
var nextArray = mjsContent.indexOf(" = [", afterEq);
var arrayText = mjsContent.substring(afterEq, nextArray);

// Extract quoted strings
var entries = [];
var i = 0;
while (i < arrayText.length) {
  while (i < arrayText.length && /[\\s\\n]/.test(arrayText[i])) i++;
  if (i >= arrayText.length) break;
  if (arrayText[i] === "\"") {
    i++; // skip opening quote
    var entry = "";
    while (i < arrayText.length) {
      if (arrayText[i] === "\\" && i + 1 < arrayText.length) { entry += arrayText[i] + arrayText[i+1]; i += 2; }
      else if (arrayText[i] === "\"") { entries.push(entry); i++; break; }
      else { entry += arrayText[i]; i++; }
    }
  } else { i++; }
}

// Extract blocks from TOML
const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");
const allowlistsStart = tomlContent.indexOf("[[allowlists]]");
const rulesStart = tomlContent.indexOf("[[rules]]", allowlistsStart);
const allowlistSection = tomlContent.substring(allowlistsStart, rulesStart);

var blocks = [];
var re = /'''(.*?)'''/gs;
var m;
while ((m = re.exec(allowlistSection)) !== null) { blocks.push(m[1]); }

console.log("Expected: " + entries.length + " entries");
console.log("Actual: " + blocks.length + " blocks\n");

// Compare all 84
var totalMismatches = 0;
for (var i = 0; i < entries.length; i++) {
  var expected = entries[i];
  var actual = blocks[i] || "MISSING";

  if (i >= blocks.length) {
    console.log("Entry " + (i+1) + ": MISSING from TOML");
    totalMismatches++;
    continue;
  }

  if (expected !== actual) {
    totalMismatches++;
    console.log("\nEntry " + (i+1) + " MISMATCH:");
    console.log("  Expected: " + JSON.stringify(expected));
    console.log("  Actual:   " + JSON.stringify(actual));

    var firstDiff = -1;
    var minLen = Math.min(expected.length, actual.length);
    for (var j = 0; j < minLen; j++) {
      if (expected[j] !== actual[j]) { firstDiff = j; break; }
    }
    if (firstDiff >= 0) {
      console.log("  First diff at pos " + firstDiff + ":");
      console.log("    Expected char code: " + expected.charCodeAt(firstDiff) + " '" + expected[firstDiff] + "'");
      console.log("    Actual char code:   " + actual.charCodeAt(firstDiff) + " '" + actual[firstDiff] + "'");
    }

    var start = Math.max(0, firstDiff - 30);
    var end = Math.min(expected.length, actual.length, firstDiff + 30);
    console.log("  Expected[" + start + "..." + end + "]: " + JSON.stringify(expected.substring(start, end)));
    console.log("  Actual[" + start + "..." + end + "]:   " + JSON.stringify(actual.substring(start, end)));
  }
}

console.log("\n\nTotal: " + entries.length + " expected, " + blocks.length + " actual, " + totalMismatches + " mismatches");