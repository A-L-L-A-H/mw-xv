const db = require('better-sqlite3')('.plan/.brain/taskos.sqlite');
const codes = [];
for (let i = 1; i <= 66; i++) {
  codes.push(`M${String(i).padStart(2, '0')}`);
}
const placeholders = codes.map(() => '?').join(',');
const stmt = db.prepare(`UPDATE nodes SET status = 'done' WHERE code IN (${placeholders})`);
const result = stmt.run(...codes);
console.log(`Updated ${result.changes} tasks to 'done'`);