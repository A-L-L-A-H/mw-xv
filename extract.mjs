const fs = require("fs");
const mjsContent = fs.readFileSync("Z:/repo/mw-xv/scripts/check-gitleaks-config.mjs", "utf8");

// Extract the array content between [ and ][
const bracketStart = mjsContent.indexOf("expectedAllowlistExpressions") + "expectedAllowlistExpressions".length + 1;
const arraySection = mjsContent.substring(bracketStart);

// Find the closing ][
const closeIdx = mjsContent.indexOf("] [", bracketStart);
const inner = mjsContent.substring(bracketStart, closeIdx);

// Extract all quoted strings
const entries = [];
let i = 0;
while (i < inner.length) {
  while (i < inner.length && /[\s\n,]/.test(inner[i])) i++;
  if (i >= inner.length) break;
  if (inner[i] === '"') {
    i++; // skip opening quote
    let entry = "";
    while (i < inner.length) {
      if (inner[i] === "\\" && i + 1 < inner.length) { entry += inner[i] + inner[i+1]; i += 2; }
      else if (inner[i] === '"') { entries.push(entry); i++; break; }
      else { entry += inner[i]; i++; }
    }
  } else { i++; }
}

console.log("Found " + entries.length + " entries");
for (let j = 0; j < Math.min(5, entries.length); j++) {
  console.log("Entry " + (j+1) + ": " + JSON.stringify(entries[j]));
}