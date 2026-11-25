const fs = require('fs');
let content = fs.readFileSync('packages/assets/scripts/render-youtube-thumbnails.mjs', 'utf8');
const lines = content.split('\n');
console.log('Line 36 actual:', JSON.stringify(lines[35]));
// Fix: change [\]] to [\]] - the issue is the backslash before ] in the character class
// The regex is: /\([|\\*_`[\]]\)/gu
// Should be: /\([|\\*_`[\]]\)/gu - but the issue is the escaped ]
lines[35] = '  text = text.replace(/\\\\([|\\\\*_`[\\]])\/gu, "$1");';
console.log('Line 36 new:', JSON.stringify(lines[35]));
content = lines.join('\n');
fs.writeFileSync('packages/assets/scripts/render-youtube-thumbnails.mjs', content);
console.log('done');