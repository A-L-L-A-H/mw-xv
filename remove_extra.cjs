const fs = require("fs");

const tomlContent = fs.readFileSync("Z:/repo/mw-xv/.gitleaks.toml", "utf8");

// Remove the 85th block: '''eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl'''
// This block is '''eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl'''

// We need to find and remove the '''...''' block containing this JWT token
// The block is: '''eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl'''

// Strategy: Replace '''<JWT>''' with empty or remove the entire '''...''' block
// But we need to be careful about TOML syntax

// Let me find the exact position of this block
const jwtBlock = "'''eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl'''";

// Find and replace this block
if (tomlContent.includes(jwtBlock)) {
  console.log("Found JWT block in TOML");
  const newToml = tomlContent.replace(jwtBlock, "");

  // Also need to clean up any trailing commas or syntax issues
  // The block was likely in a regexes = [ array, so removing it might leave a trailing comma

  // Actually, let me just write the file and see if the test passes
  fs.writeFileSync("Z:/repo/mw-xv/.gitleaks.toml", newToml);
  console.log("Removed JWT block from TOML");

  // Verify the block count
  const re = /'''(.*?)'''/gs;
  const sectionStart = tomlContent.indexOf("[[allowlists]]");
  const sectionEnd = tomlContent.indexOf("[[rules]]", sectionStart);
  const section = tomlContent.substring(sectionStart, sectionEnd);
  const blocks = [];
  let m;
  while ((m = re.exec(section)) !== null) {
    blocks.push(m[1]);
  }
  console.log(`Blocks in section after removal: ${blocks.length}`);

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
} else {
  console.log("JWT block not found in TOML - trying different approach");
  // Try finding with different quote patterns
  const jwtBlock2 = "'''eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJl'''";
  // Actually, the content might have backslash differences
  // Let me just try removing by pattern
  const re = /'''[^']*eyJhbGciOiJFUzI1NiJ9[^']*'''/gs;
  const matches = tomlContent.match(re);
  if (matches) {
    console.log(`Found ${matches.length} JWT block(s) with different escaping`);
    for (const m of matches) {
      console.log(`  Block: ${m.substring(0, 80)}`);
    }
  }
}