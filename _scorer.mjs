import fs from 'fs';

const issues = JSON.parse(fs.readFileSync('_issues_raw.json', 'utf8'));

const allowedLabels = new Set(['auto-heal', 'gate-failure', 'audit', 'security', 'e2e', 'config', 'drift', 'hygiene', 'idea', 'regression', 'deps', 'docs', 'promotion', 'pipeline', 'db', 'disaster']);

const severityMap = {
  critical: 30,
  high: 25,
  medium: 15,
  low: 5,
  unlabeled: 10
};

const candidates = issues.filter(issue => {
  const labels = issue.labels.map(l => l.name.toLowerCase());
  return labels.some(l => allowedLabels.has(l));
});

console.log(`Found ${candidates.length} issues with allowed labels out of ${issues.length} total`);

const results = candidates.map(issue => {
  const labels = issue.labels.map(l => l.name.toLowerCase());
  const body = issue.body || '';
  const createdAt = new Date(issue.createdAt);
  const now = new Date();
  const daysSinceCreated = (now - createdAt) / (1000 * 60 * 60 * 24);
  const daysSinceUpdated = issue.updatedAt ? (now - new Date(issue.updatedAt)) / (1000 * 60 * 60 * 24) : null;
  
  // SEVERITY
  let severityScore = severityMap.unlabeled;
  const severityLabels = labels.filter(l => l in severityMap);
  if (severityLabels.length > 0) {
    const severities = severityLabels.map(l => severityMap[l]);
    severityScore = Math.max(...severities);
  }
  
  // RECENCY
  let recencyScore;
  if (daysSinceCreated < 1) recencyScore = 20;
  else if (daysSinceCreated < 7) recencyScore = 15;
  else if (daysSinceCreated < 30) recencyScore = 10;
  else recencyScore = 0;
  
  // BLAST_RADIUS
  let blastRadiusScore = 5;
  const bodyLower = body.toLowerCase();
  const pkgAffectMatch = bodyLower.match(/affects? (\d+)/);
  if (pkgAffectMatch) {
    const count = parseInt(pkgAffectMatch[1]);
    if (count > 5) blastRadiusScore = 20;
    else if (count >= 2) blastRadiusScore = 15;
    else blastRadiusScore = 10;
  } else {
    if (labels.some(l => l.includes('security') || l.includes('vuln') || l.includes('audit'))) {
      blastRadiusScore = 15;
    } else if (labels.some(l => l.includes('idea') || l.includes('docs'))) {
      blastRadiusScore = 5;
    } else if (labels.some(l => l.includes('code-quality') || l.includes('lint') || l.includes('tsc'))) {
      blastRadiusScore = 10;
    }
  }
  
  // FIX_EFFORT_INVERSE
  let fixEffortScore = 0;
  const effortPatterns = [
    /<1hour|less than 1 hour|under 1 hour/i,
    /<4hour|less than 4 hours|under 4 hours/i,
    /<1day|less than 1 day|under 1 day|1 day|24 hours/i
  ];
  let effortFound = false;
  for (let i = 0; i < effortPatterns.length; i++) {
    if (effortPatterns[i].test(bodyLower)) {
      fixEffortScore = 20 - i * 5;
      effortFound = true;
      break;
    }
  }
  if (!effortFound) {
    if (bodyLower.includes('typo') || bodyLower.includes('fix ') || bodyLower.includes('change ')) {
      fixEffortScore = 15;
    }
  }
  
  // STALENESS_PENALTY
  let stalenessPenalty = 0;
  if (daysSinceUpdated) {
    if (daysSinceUpdated > 30) stalenessPenalty = -30;
    else if (daysSinceUpdated > 14) stalenessPenalty = -15;
  }
  
  const total = Math.max(0, Math.min(100, severityScore + recencyScore + blastRadiusScore + fixEffortScore + stalenessPenalty));
  
  let priorityLabel = 'P2';
  let why = '';
  if (total >= 70) {
    priorityLabel = 'P0';
    why = `Score ${total}: severity=${severityScore}, recency=${recencyScore}, blast=${blastRadiusScore}, effort=${fixEffortScore}, stale=${stalenessPenalty}`;
  } else if (total >= 40) {
    priorityLabel = 'P1';
    why = `Score ${total}: severity=${severityScore}, recency=${recencyScore}, blast=${blastRadiusScore}, effort=${fixEffortScore}, stale=${stalenessPenalty}`;
  } else {
    priorityLabel = 'P2';
    why = `Score ${total}: severity=${severityScore}, recency=${recencyScore}, blast=${blastRadiusScore}, effort=${fixEffortScore}, stale=${stalenessPenalty}`;
  }
  
  return {
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map(l => l.name),
    assignees: issue.assignees.map(a => a.login),
    createdAt,
    daysSinceCreated: Math.round(daysSinceCreated),
    daysSinceUpdated: daysSinceUpdated ? Math.round(daysSinceUpdated) : null,
    severityScore,
    recencyScore,
    blastRadiusScore,
    fixEffortScore,
    stalenessPenalty,
    total,
    priorityLabel,
    why
  };
});

results.sort((a, b) => b.total - a.total);

const p0 = results.filter(r => r.priorityLabel === 'P0').length;
const p1 = results.filter(r => r.priorityLabel === 'P1').length;
const p2 = results.filter(r => r.priorityLabel === 'P2').length;

console.log(`\nP0 (score >= 70): ${p0}`);
console.log(`P1 (score 40-69): ${p1}`);
console.log(`P2 (score < 40): ${p2}`);

console.log(`\n=== TOP 20 ISSUES BY SCORE ===`);
for (let i = 0; i < Math.min(20, results.length); i++) {
  const r = results[i];
  console.log(`#${r.number} [${r.priorityLabel}] ${r.title.substring(0, 60)}... (score: ${r.total})`);
}

console.log(`\n=== P0 ISSUES (score >= 70) ===`);
const p0Issues = results.filter(r => r.priorityLabel === 'P0');
p0Issues.forEach(r => {
  console.log(`#${r.number} [P0] ${r.title.substring(0, 80)}...`);
  console.log(`   Why: ${r.why}`);
});

console.log(`\n=== P1 ISSUES (score 40-69) ===`);
const p1Issues = results.filter(r => r.priorityLabel === 'P1');
p1Issues.forEach(r => {
  console.log(`#${r.number} [P1] ${r.title.substring(0, 80)}...`);
  console.log(`   Why: ${r.why}`);
});

console.log(`\n=== AUTO-CLOSE CANDIDATES (P2, no assignee, >30d stale) ===`);
const autoClose = results.filter(r => r.priorityLabel === 'P2' && (!r.assignees || r.assignees.length === 0) && (r.daysSinceUpdated > 30));
autoClose.forEach(r => {
  console.log(`#${r.number} [P2] ${r.title.substring(0, 80)}... (stale ${r.daysSinceUpdated}d, no assignee)`);
});

// Write results
fs.writeFileSync('_issue_scores.json', JSON.stringify(results, null, 2));
console.log(`\nResults written to _issue_scores.json`);
