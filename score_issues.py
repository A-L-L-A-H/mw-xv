import json, sys
from datetime import datetime, timezone
from collections import Counter

# Read issues from gh output
input_data = sys.stdin.read()
data = json.loads(input_data)

allowed = ['auto-heal', 'gate-failure', 'audit', 'security', 'e2e', 'config', 'drift', 'hygiene', 'idea', 'regression', 'deps', 'docs', 'promotion', 'pipeline', 'db', 'disaster']
candidates = []
for issue in data:
    labels = [l['name'] for l in issue.get('labels', [])]
    if any(l in allowed for l in labels):
        candidates.append(issue)

print(f"Total issues: {len(data)}")
print(f"Filtered candidates: {len(candidates)}")

def compute_severity(issue):
    """Assign severity based on issue content/type."""
    body = issue.get('body', '')
    title = issue.get('title', '').lower()

    # Check for security issues
    if '[security]' in body.lower() or '[security]' in title:
        return 30
    if 'vuln-' in body.lower() or 'vulnerability' in body.lower():
        return 30

    # Check for gate failures
    if 'gate failure' in body.lower() or 'merge' in body.lower() and 'failure' in body.lower():
        return 25

    # Check for e2e issues
    if '[e2e]' in body.lower() or '[e2e]' in title:
        return 15

    # Check for vulnerability labels
    labels = [l['name'] for l in issue.get('labels', [])]
    if 'vuln-cargo' in labels or 'vuln-go' in labels:
        return 30

    # Check for priority labels
    if 'priority:p0' in labels:
        return 30
    if 'priority:p1' in labels:
        return 25
    if 'priority:P2' in labels:
        return 5

    # Default
    return 10

def compute_recency(issue):
    created_str = issue.get('createdAt', '')
    recency = 0
    if created_str:
        created = datetime.fromisoformat(created_str.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        diff_days = (now - created).days
        if diff_days < 1:
            recency = 20
        elif diff_days < 7:
            recency = 15
        elif diff_days < 30:
            recency = 10
        else:
            recency = 0
    return recency

def compute_blast_radius(issue):
    body = issue.get('body', '').lower()
    # Check body for package references
    import re
    # Look for "affects X pkgs" pattern
    match = re.search(r'affects\s+(\d+)(?:-(\d+))?\s+pkgs', body)
    if match:
        if match.group(1) and int(match.group(1)) > 5:
            return 20
        elif match.group(1) and int(match.group(1)) >= 2 and int(match.group(1)) <= 5:
            return 15

    # Check for "1 pkg" or single package
    if '1 pkg' in body or 'single' in body:
        return 10

    # Check for idea/docs
    if 'idea' in body or 'docs' in body:
        return 5

    return 10  # default

def compute_fix_effort(issue):
    body = issue.get('body', '').lower()

    if ' <1h' in body or '1 hour' in body or 'less than 1 hour' in body or 'under 1 hour' in body:
        return 20
    elif ' <4h' in body or '4 hours' in body or 'less than 4 hours' in body or 'under 4 hours' in body:
        return 15
    elif ' <1d' in body or '1 day' in body or 'less than 1 day' in body or 'under 1 day' in body:
        return 10
    elif ' >1d' in body or 'more than 1 day' in body:
        return 5

    return 0  # unknown

def compute_staleness(issue):
    updated_str = issue.get('updatedAt', '')
    staleness = 0
    if updated_str:
        updated = datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        diff_days = (now - updated).days
        if diff_days > 30:
            staleness = -30
        elif diff_days > 14:
            staleness = -15
    return staleness

def compute_score(issue):
    severity = compute_severity(issue)
    recency = compute_recency(issue)
    blast = compute_blast_radius(issue)
    effort = compute_fix_effort(issue)
    staleness = compute_staleness(issue)

    total = severity + recency + blast + effort + staleness
    total = max(0, min(100, total))  # clamp 0-100

    if total >= 70:
        priority = 'P0'
    elif total >= 40:
        priority = 'P1'
    else:
        priority = 'P2'

    return {
        'number': issue['number'],
        'title': issue['title'][:80],
        'severity': severity,
        'recency': recency,
        'blast': blast,
        'effort': effort,
        'staleness': staleness,
        'total': total,
        'priority': priority
    }

results = [compute_score(issue) for issue in candidates]
results.sort(key=lambda x: x['total'], reverse=True)

# Print top 30
print(f"\nTop {min(30, len(results))} issues by priority score:")
for r in results[:30]:
    print(f"#{r['number']} | {r['priority']} | score:{r['total']} | sev:{r['severity']} rec:{r['recency']} blast:{r['blast']} eff:{r['effort']} stale:{r['staleness']} | {r['title']}")

# Print summary
p0 = [r for r in results if r['priority'] == 'P0']
p1 = [r for r in results if r['priority'] == 'P1']
p2 = [r for r in results if r['priority'] == 'P2']

print(f"\nSummary: P0={len(p0)}, P1={len(p1)}, P2={len(p2)}")

if p0:
    print("\nP0 ISSUES (fix now):")
    for r in p0:
        print(f"  #{r['number']}: {r['title'][:60]}...")

if p1:
    print("\nP1 ISSUES (fix soon):")
    for r in p1[:10]:
        print(f"  #{r['number']}: {r['title'][:60]}...")

if p2:
    print("\nP2 ISSUES (backlog):")
    for r in p2[:5]:
        print(f"  #{r['number']}: {r['title'][:60]}...")