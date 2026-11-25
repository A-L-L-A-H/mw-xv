import json
from datetime import datetime, timezone

# All issues from the filtered list
issues = [
    {"number": 340, "title": "[CODE-QUALITY] todo-density: 0 findings (10 matches, 0 actual TODOs)", "labels": ["priority:low", "priority:p1", "audit"], "createdAt": "2026-11-25T05:41:46Z", "updatedAt": "2026-11-25T06:28:52Z", "assignees": 0, "comments": 0},
    {"number": 339, "title": "[CODE-QUALITY] broken-links: 1 finding", "labels": ["priority:low", "priority:p1", "audit"], "createdAt": "2026-11-25T05:41:34Z", "updatedAt": "2026-11-25T06:28:54Z", "assignees": 0, "comments": 0},
    {"number": 338, "title": "[CODE-QUALITY] bundle-budget: 2 findings (build required)", "labels": ["priority:high", "priority:p0", "audit"], "createdAt": "2026-11-25T05:41:25Z", "updatedAt": "2026-11-25T06:27:58Z", "assignees": 0, "comments": 1},
    {"number": 337, "title": "[CODE-QUALITY] circular-deps: 0 findings", "labels": ["priority:low", "priority:p1", "audit"], "createdAt": "2026-11-25T05:39:32Z", "updatedAt": "2026-11-25T06:28:56Z", "assignees": 0, "comments": 0},
    {"number": 336, "title": "[CODE-QUALITY] high-complexity: 0 findings", "labels": ["priority:low", "priority:p1", "audit"], "createdAt": "2026-11-25T05:39:21Z", "updatedAt": "2026-11-25T06:28:59Z", "assignees": 0, "comments": 0},
    {"number": 335, "title": "[CODE-QUALITY] dead-code: 10 findings", "labels": ["priority:medium", "bug", "priority:p1", "audit"], "createdAt": "2026-11-25T05:39:12Z", "updatedAt": "2026-11-25T06:29:01Z", "assignees": 0, "comments": 0},
    {"number": 334, "title": "[CODE-QUALITY] lint-errors: 2 findings", "labels": ["bug", "priority:p0", "priority:p1", "audit"], "createdAt": "2026-11-25T05:38:57Z", "updatedAt": "2026-11-25T06:28:09Z", "assignees": 0, "comments": 1},
    {"number": 333, "title": "[CODE-QUALITY] tsc-errors: 1019 findings", "labels": ["bug", "priority:p1", "audit"], "createdAt": "2026-11-25T05:38:45Z", "updatedAt": "2026-11-25T06:29:03Z", "assignees": 0, "comments": 0},
    {"number": 286, "title": "Audit: Desktop ISP proxy defaults to port 8091 instead of 3002 and API OpenAPI hardcodes localhost:3000", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T02:09:46Z", "updatedAt": "2026-11-25T06:28:12Z", "assignees": 0, "comments": 2},
    {"number": 284, "title": "Audit: Missing MILLISECONDS_PER_DAY in @moonwitness/types and raw duration literals scattered", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T02:09:39Z", "updatedAt": "2026-11-25T06:28:16Z", "assignees": 0, "comments": 1},
    {"number": 283, "title": "Audit: Error-to-message normalization duplicated across 30+ sites and 4 private helpers", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T02:09:34Z", "updatedAt": "2026-11-25T06:28:19Z", "assignees": 0, "comments": 2},
    {"number": 282, "title": "Audit: Private-mesh CIDR and loopback validators still duplicated in ai-runtime, local-ai, and orm-cloud", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T02:09:29Z", "updatedAt": "2026-11-25T06:28:22Z", "assignees": 0, "comments": 2},
    {"number": 281, "title": "Audit: DEFAULT_TIMEOUT_MS hardcoded in 3 packages with different values (5s/15s/30s)", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T01:54:24Z", "updatedAt": "2026-11-25T06:28:24Z", "assignees": 0, "comments": 2},
    {"number": 280, "title": "Audit: mcp-moonwitness hardcodes localhost:3000 instead of using @moonwitness/types service endpoints", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T01:53:40Z", "updatedAt": "2026-11-25T06:28:27Z", "assignees": 0, "comments": 2},
    {"number": 279, "title": "Audit: trimTrailingSlashes helper duplicated across 6 packages", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-25T01:53:29Z", "updatedAt": "2026-11-25T06:28:29Z", "assignees": 0, "comments": 2},
    {"number": 213, "title": "Audit: orm-* test scripts inconsistent (tsc-check gate applied to only 11 of 30 packages)", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-23T23:10:31Z", "updatedAt": "2026-11-25T06:28:43Z", "assignees": 0, "comments": 5},
    {"number": 200, "title": "Audit: Mirrored WhatsApp runtime modules in apps/api vs packages/orm-whatsapp", "labels": ["priority:p0", "audit", "auto-generated"], "createdAt": "2026-11-23T20:39:55Z", "updatedAt": "2026-11-25T06:28:46Z", "assignees": 0, "comments": 2},
]

now = datetime.now(timezone.utc)

def compute_score(issue):
    labels = set(issue["labels"])
    created = datetime.fromisoformat(issue["createdAt"].replace('Z', '+00:00'))
    updated = datetime.fromisoformat(issue["updatedAt"].replace('Z', '+00:00'))
    days_since_created = (now - created).days
    days_since_updated = (now - updated).days
    assignees = issue["assignees"]
    comments = issue["comments"]

    # SEVERITY
    if "priority:critical" in labels or "critical" in labels:
        severity = 30
    elif "priority:high" in labels or "priority:p0" in labels:
        severity = 25
    elif "priority:medium" in labels:
        severity = 15
    elif "priority:low" in labels or "priority:p1" in labels:
        severity = 5
    else:
        severity = 10  # unlabeled

    # RECENCY
    if days_since_created < 1:
        recency = 20
    elif days_since_created < 7:
        recency = 15
    elif days_since_created < 30:
        recency = 10
    else:
        recency = 0

    # BLAST_RADIUS - estimate from title/description
    title_lower = issue["title"].lower()
    if any(kw in title_lower for kw in ["30+", "6 packages", "3 packages", "orm-*", "mirrored", "across"]):
        blast = 20  # affects >5 pkgs
    elif any(kw in title_lower for kw in ["duplicated", "inconsistent", "hardcode"]):
        blast = 15  # 2-5 pkgs
    elif any(kw in title_lower for kw in ["dead-code", "lint", "tsc", "bundle", "circular", "complexity", "todo", "broken"]):
        blast = 10  # 1 pkg
    else:
        blast = 5  # idea/docs

    # FIX_EFFORT_INVERSE - estimate from title
    if any(kw in title_lower for kw in ["todo-density", "broken-links", "circular-deps", "high-complexity", "dead-code: 10", "lint-errors: 2", "bundle-budget: 2"]):
        effort_inv = 20  # <1h
    elif any(kw in title_lower for kw in ["tsc-errors: 1019", "hardcode", "missing", "duplicated", "trimtrailing", "inconsistent"]):
        effort_inv = 15  # <4h
    elif any(kw in title_lower for kw in ["mirrored", "orm-*", "30+", "6 packages"]):
        effort_inv = 10  # <1d
    else:
        effort_inv = 5  # >1d or unknown

    # STALENESS_PENALTY
    if days_since_updated > 30:
        stale_penalty = -30
    elif days_since_updated > 14:
        stale_penalty = -15
    else:
        stale_penalty = 0

    total = severity + recency + blast + effort_inv + stale_penalty
    total = max(0, min(100, total))

    # Determine priority label
    if total >= 70:
        priority = "P0"
    elif total >= 40:
        priority = "P1"
    else:
        priority = "P2"

    return {
        **issue,
        "score": total,
        "priority": priority,
        "severity": severity,
        "recency": recency,
        "blast": blast,
        "effort_inv": effort_inv,
        "stale_penalty": stale_penalty,
        "days_since_updated": days_since_updated
    }

scored = [compute_score(i) for i in issues]
scored.sort(key=lambda x: -x["score"])

for i in scored:
    print(f"#{i['number']} [{i['priority']}] score={i['score']} (sev={i['severity']}, rec={i['recency']}, blast={i['blast']}, effort={i['effort_inv']}, stale={i['stale_penalty']}) - {i['title']}")

# Group by priority
p0 = [i for i in scored if i["priority"] == "P0"]
p1 = [i for i in scored if i["priority"] == "P1"]
p2 = [i for i in scored if i["priority"] == "P2"]

print(f"\n=== SUMMARY ===")
print(f"P0 (fix now): {len(p0)} issues")
print(f"P1 (fix soon): {len(p1)} issues")
print(f"P2 (backlog): {len(p2)} issues")