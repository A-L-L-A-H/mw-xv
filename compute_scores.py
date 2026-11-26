import json, os, re
from datetime import datetime, timezone, timedelta

# Load all issues
path = r'C:\Users\bjo16\.claude\projects\Z--repo-mw-xv\46487803-01a8-4e02-9f07-9af8e183af03\tool-results\bdl0vs7ue.txt'
with open(path, 'rb') as f:
    raw = f.read()
start = raw.find(b'[')
end = raw.rfind(b']') + 1
issues = json.loads(raw[start:end])

# Reference date: now is 2026-11-27 (from system prompt)
now = datetime(2026, 11, 27, tzinfo=timezone.utc)

def safe_title(text):
    """Sanitize title for printing - replace non-ASCII chars"""
    if not text:
        return ''
    return text.replace('→', '->').replace('²', '**').encode('ascii', 'replace').decode('ascii')

# Label severity mapping
def get_severity(labels):
    has_p0 = any(lbl == 'priority:p0' for lbl in labels)
    has_p1 = any(lbl == 'priority:p1' for lbl in labels)
    has_gate_failure = any('gate-failure' in lbl for lbl in labels)
    has_auto_heal = any('auto-heal' in lbl for lbl in labels)
    has_idea = any('idea' in lbl for lbl in labels)
    has_docs = any('docs' in lbl for lbl in labels)

    if has_p0 or has_gate_failure:
        return 30  # critical
    elif has_p1 or has_auto_heal:
        return 25  # high
    elif has_idea:
        return 5   # low
    elif has_docs:
        return 5   # low
    else:
        return 10  # unlabeled

# Recency scoring: created <24h=20, <7d=15, <30d=10, >30d=0
def get_recency_score(created_str):
    try:
        created = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
    except:
        return 0

    delta = now - created
    days = delta.total_seconds() / 86400

    if days < 1:
        return 20
    elif days < 7:
        return 15
    elif days < 30:
        return 10
    else:
        return 0

# Blast radius
def get_blast_radius(issue):
    body = issue.get('body', '') or ''
    title = issue.get('title', '') or ''
    text = (body + ' ' + title).lower()

    pkg_refs = re.findall(r'packages/[a-zA-Z0-9_-]+', text)
    unique_pkgs = set(pkg_refs)

    if not unique_pkgs:
        labels = issue.get('labels', [])
        if any('idea' in lbl for lbl in labels):
            return 5
        if any('docs' in lbl for lbl in labels):
            return 5
        return 10

    count = len(unique_pkgs)
    if count > 5:
        return 20
    elif count >= 2:
        return 15
    else:
        return 10

# Fix effort inverse
def get_fix_effort_score(issue):
    body = issue.get('body', '') or ''
    title = issue.get('title', '') or ''
    text = (body + ' ' + title).lower()

    labels = issue.get('labels', [])
    if any('auto-fix-requested' in lbl for lbl in labels):
        return 15  # < 4 hours, can be auto-fixed
    if any('auto-heal' in lbl for lbl in labels):
        return 20  # auto-heal, < 1 hour

    # Check body for effort hints
    if re.search(r'\b(quick|minor|trivial|small)\b', text):
        return 20
    elif re.search(r'\b(requires?|complex|refactor|significant)\b', text):
        return 5

    return 0

# Staleness penalty
def get_staleness_penalty(updated_str):
    try:
        updated = datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
    except:
        return 0

    delta = now - updated
    days = delta.total_seconds() / 86400

    if days > 30:
        return -30
    elif days > 14:
        return -15
    else:
        return 0

# Compute scores for all issues
results = []

for i, issue in enumerate(issues):
    num = issue.get('number', 'N/A')
    title = issue.get('title', 'N/A')[:80]
    labels = [l.get('name','') for l in issue.get('labels', [])]
    created = issue.get('createdAt', '')
    updated = issue.get('updatedAt', '')
    assignees = issue.get('assignees', [])
    body = issue.get('body', '') or ''
    comments = issue.get('comments', 0)

    severity = get_severity(labels)
    recency = get_recency_score(created)
    blast_radius = get_blast_radius(issue)
    fix_effort = get_fix_effort_score(issue)
    staleness = get_staleness_penalty(updated)

    total = severity + recency + blast_radius + fix_effort + staleness
    total = max(0, min(100, total))

    if total >= 70:
        priority = 'P0'
        priority_label = 'priority:P0'
        why = f"Score: {total}"
    elif total >= 40:
        priority = 'P1'
        priority_label = 'priority:P1'
        why = f"Score: {total}"
    else:
        priority = 'P2'
        priority_label = 'priority:P2'
        why = f"Score: {total}"
        if staleness <= -30 and len(assignees) == 0:
            priority = 'CLOSED'
            priority_label = 'auto-closed'
            why = f"Score: {total} - Auto-closed: stale P2, no activity 30d. Reopen if still relevant."

    results.append({
        'number': num,
        'title': title,
        'labels': labels,
        'priority': priority,
        'priority_label': priority_label,
        'score': total,
        'why': why,
        'severity': severity,
        'recency': recency,
        'blast_radius': blast_radius,
        'fix_effort': fix_effort,
        'staleness': staleness,
        'assignees': assignees,
        'created': created,
        'updated': updated,
    })

# Sort by priority (P0 first, then P1, then P2/closed), then by score descending
priority_order = {'P0': 0, 'P1': 1, 'P2': 2, 'CLOSED': 3}
results.sort(key=lambda x: (priority_order.get(x['priority'], 99), -x['score']))

# Print summary
print("=" * 80)
print("PRIORITY TRIAGE SUMMARY")
print("=" * 80)

p0_issues = [r for r in results if r['priority'] == 'P0']
p1_issues = [r for r in results if r['priority'] == 'P1']
p2_issues = [r for r in results if r['priority'] == 'P2']
closed_issues = [r for r in results if r['priority'] == 'CLOSED']

print(f"\nP0 (fix now, score >= 70): {len(p0_issues)}")
for issue in p0_issues:
    print(f"  #{issue['number']}: {safe_title(issue['title'])} ... score: {issue['score']} {issue['why']}")

print(f"\nP1 (fix soon, score 40-69): {len(p1_issues)}")
for issue in p1_issues:
    print(f"  #{issue['number']}: {safe_title(issue['title'])} ... score: {issue['score']} {issue['why']}")

print(f"\nP2 (backlog, score < 40): {len(p2_issues)}")
for issue in p2_issues:
    print(f"  #{issue['number']}: {safe_title(issue['title'])} ... score: {issue['score']} {issue['why']}")

print(f"\nCLOSED (auto-closed P2): {len(closed_issues)}")
for issue in closed_issues:
    print(f"  #{issue['number']}: {safe_title(issue['title'])} ... score: {issue['score']} {issue['why']}")

# Dedupe analysis
print(f"\nDEDUPE ANALYSIS:")
file_groups = {}
for issue in results:
    text = (issue['title'] or '') + ' ' + (issue.get('body') or '')
    files = re.findall(r'(?:packages|docs|scripts)/[a-zA-Z0-9._/-]+', text.lower())
    for f in files:
        if f not in file_groups:
            file_groups[f] = []
        file_groups[f].append(issue['number'])

dupes = {k: v for k, v in file_groups.items() if len(v) > 1}
print(f"  File groups with multiple issues: {len(dupes)}")
for files, nums in list(dupes.items())[:5]:
    print(f"    {files}: issues {nums}")

# Generate fixer queue summary
print(f"\nFIXER QUEUE:")
print("=" * 80)
timestamp = now.strftime('%Y-%m-%d %H:%M UTC')

print(f"\n## Fixer Queue (updated {timestamp})")
print()

p0_queue = [r for r in results if r['priority'] == 'P0']
p1_queue = [r for r in results if r['priority'] == 'P1']
p2_queue = [r for r in results if r['priority'] == 'P2']

if p0_queue:
    print("### P0 (fix now)")
    for issue in p0_queue[:10]:
        print(f"- #{issue['number']} {safe_title(issue['title'])} [score: {issue['score']}] {issue['why'][:80]}")
    if len(p0_queue) > 10:
        print(f"  ... and {len(p0_queue)-10} more")

print()
if p1_queue:
    print("### P1 (fix soon)")
    for issue in p1_queue[:10]:
        print(f"- #{issue['number']} {safe_title(issue['title'])} [score: {issue['score']}]")
    if len(p1_queue) > 10:
        print(f"  ... and {len(p1_queue)-10} more")

print()
if p2_queue:
    print(f"### P2 (backlog) — {len(p2_queue)} issues")

print()
print(f"P0 count: {len(p0_queue)}")
print(f"P1 count: {len(p1_queue)}")
print(f"Closed count: {len(closed_issues)}")