import fs from 'fs';

const issues = JSON.parse(fs.readFileSync('_issues_raw.json', 'utf8'));

console.log(`=== FULL ISSUE ANALYSIS ===`);
console.log(`Total issues: ${issues.length}\n`);

// Show all issues with their labels
issues.forEach((issue, i) => {
  const labels = issue.labels.map(l => l.name).join(', ');
  const created = new Date(issue.createdAt).toLocaleDateString();
  const bodyPreview = (issue.body || '').substring(0, 80).replace(/\n/g, ' ');
  console.log(`#${issue.number} [${labels}] ${issue.title.substring(0, 50)}... (created: ${created})`);
  console.log(`  Body: ${bodyPreview}`);
  console.log();
});
