const db = require('better-sqlite3')('.plan/.brain/taskos.sqlite');
const tasks = db.prepare("SELECT code, status FROM nodes WHERE code LIKE 'M%' ORDER BY code").all();
console.log(tasks);