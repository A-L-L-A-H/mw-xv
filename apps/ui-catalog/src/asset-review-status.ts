/**
 * Canonical asset review-status resolver for the UI Catalog.
 *
 * Maps an asset manifest record plus its provenance entry (from
 * packages/assets/licenses.json) to a single presentation status:
 * 'approved' | 'review' | 'blocked' | 'unverified'.
 *
 * Fail-closed: missing or conflicting metadata can never resolve to
 * 'approved'. Provenance (license review) always dominates the manifest's
 * optimistic status when it is more restrictive.
 */

export type AssetReviewStatus = 'approved' | 'review' | 'blocked' | 'unverified';

export type AssetManifestRecord = {
  path: string;
  kind?: string;
  status?: string;
  [key: string]: unknown;
};

export type AssetProvenanceEntry = {
  path: string;
  status?: string;
  license?: string;
  [key: string]: unknown;
};

/** Provenance review states that must block runtime/distribution usage. */
const BLOCKED_PROVENANCE_STATUSES = new Set(['blocked']);

/** License markers that mean provenance has not been verified yet. */
const UNVERIFIED_LICENSES = new Set(['unverified', 'unknown', '']);

/**
 * Resolve the canonical review status for a single asset.
 *
 * Priority (most restrictive wins):
 *   1. blocked provenance -> 'blocked'
 *   2. unverified/missing license on a provenance entry -> 'unverified'
 *   3. provenance status 'review' -> 'review'
 *   4. manifest status 'blocked' -> 'blocked'
 *   5. manifest status 'review' -> 'review'
 *   6. manifest status 'approved' AND a known license -> 'approved'
 *   7. anything else (including no provenance at all) -> 'unverified'
 */
export function resolveAssetReviewStatus(
  asset: AssetManifestRecord,
  provenance?: AssetProvenanceEntry
): AssetReviewStatus {
  const provenanceStatus = provenance?.status?.trim().toLowerCase();
  const license = provenance?.license?.trim().toLowerCase();

  if (provenanceStatus && BLOCKED_PROVENANCE_STATUSES.has(provenanceStatus)) {
    return 'blocked';
  }
  if (provenance && (!license || UNVERIFIED_LICENSES.has(license))) {
    return 'unverified';
  }
  if (provenanceStatus === 'review') {
    return 'review';
  }

  const manifestStatus = asset.status?.trim().toLowerCase();
  if (manifestStatus === 'blocked') {
    return 'blocked';
  }
  if (manifestStatus === 'review') {
    return 'review';
  }
  if (manifestStatus === 'approved' && license === 'isc') {
    return 'approved';
  }
  return 'unverified';
}

/**
 * Build a lookup of resolved statuses for the whole manifest given the
 * provenance index parsed from licenses.json sourceAssets.
 */
export function resolveAssetReviewStatuses(
  assets: AssetManifestRecord[],
  provenanceIndex: Map<string, AssetProvenanceEntry>
): Map<string, AssetReviewStatus> {
  const resolved = new Map<string, AssetReviewStatus>();
  for (const asset of assets) {
    resolved.set(asset.path, resolveAssetReviewStatus(asset, provenanceIndex.get(asset.path)));
  }
  return resolved;
}

/**
 * Build a provenance index keyed by path from licenses.json sourceAssets.
 */
export function buildProvenanceIndex(
  sourceAssets: AssetProvenanceEntry[]
): Map<string, AssetProvenanceEntry> {
  return new Map(sourceAssets.map((entry) => [entry.path, entry]));
}
