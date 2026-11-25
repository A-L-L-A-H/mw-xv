# Telemetry Capacity and Eviction Policy

## Overview

The observability addon (`@moonwitness/orm-observability`) enforces per-tenant capacity caps on ingested telemetry records. Caps are configurable at store construction time and apply equally to both `MemoryTelemetryStore` and `SqlTelemetryStore` implementations.

## Configurable Limits

| Limit             | Default | Constructor Option   | Enforced By           |
| ----------------- | ------- | -------------------- | --------------------- |
| `maxSpans`        | 5,000   | `maxSpans`           | `ingestSpans()`       |
| `maxLogs`         | 5,000   | `maxLogs`            | `ingestLogs()`        |
| `maxMetricSeries` | 1,000   | `maxMetricSeries`    | `ingestMetrics()`     |
| `maxMetricPoints` | 120     | `maxMetricPoints`    | `ingestMetrics()`     |
| `retentionMs`     | 3,600,000 (1 h) | `retentionMs` | `prune()` (on ingest and read) |

## Span and Log Cap Behavior

When the span or log count reaches `maxSpans` / `maxLogs`, new records are rejected (`accepted: 0, rejected: N`). The store never evicts existing spans or logs to make room — overflow is rejected, not displaced. This preserves trace integrity: partial traces are preferable to silently dropped spans from an active trace.

Repeated bursts beyond the cap continue to be rejected until retention pruning removes expired records. This is the intended backpressure signal: the client should reduce send rate or increase the cap.

## Metric Series Eviction

Metric series use a different policy. When `maxMetricSeries` is exceeded and a new series arrives, the **oldest series** (lowest internal `id` / first inserted) is evicted to make room. The rejected count includes the points from the evicted series. This is a true eviction, not a rejection — the new series is accepted.

Series are ordered by `latestMetricTime` for query results, so eviction targets insertion order, not recency of data.

## Metric Point Cap Behavior

Within a single series, when `maxMetricPoints` is exceeded, only the **oldest points** (lowest `timestampMs`) are dropped. The newest points are always retained. Points with the same timestamp are merged (last write wins), so duplicates do not count against the cap.

## Retention Pruning

Records older than `retentionMs` are pruned on every ingest call (before and after processing) and on read operations (`listTraces`, `listLogs`, `listMetrics`, `summary`). Pruning removes:

- Spans where both `start_time_ms` and `end_time_ms` are before the cutoff.
- Logs where `timestamp_ms` is before the cutoff.
- Metric points where `timestamp_ms` is before the cutoff; series with zero remaining points are removed entirely.

Each prune that removes at least one record bumps the store revision by 1. Multiple prunes within a single ingest call (before + after) still result in a single revision bump.

## Revision and Deduplication Interaction

Deduplication (retransmitting the same span/log/series) does not count as a change and does not bump the revision. Cap rejections also do not bump the revision. Only actual insertions, point replacements, evictions, and pruning bump the revision.

## Configuration Example

```ts
import { SqlTelemetryStore } from '@moonwitness/orm-observability';

const store = new SqlTelemetryStore(db, {
  maxSpans: 10_000,
  maxLogs: 10_000,
  maxMetricSeries: 500,
  maxMetricPoints: 60,
  retentionMs: 7_200_000, // 2 hours
});
```

## Test Coverage

The cap enforcement matrix is covered in `packages/orm-observability/tests/telemetry-caps.test.ts` and runs against both memory and SQLite backends:

- Span cap rejection and stability across repeated bursts.
- Log cap rejection and stability across repeated bursts.
- Metric series eviction of oldest series.
- Metric point oldest-drop behavior.
- Retention pruning and revision bump.