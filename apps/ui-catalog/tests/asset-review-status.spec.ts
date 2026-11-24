import { expect, test } from '@playwright/test';
import {
  buildProvenanceIndex,
  resolveAssetReviewStatus,
  resolveAssetReviewStatuses,
} from '../src/asset-review-status';

const approvedAsset = { path: 'artwork/approved.png', status: 'approved' };
const approvedProvenance = {
  path: 'artwork/approved.png',
  status: 'approved',
  license: 'ISC',
};

const cases = [
  {
    name: 'approved manifest and verified provenance',
    asset: approvedAsset,
    provenance: approvedProvenance,
    expected: 'approved',
  },
  {
    name: 'review-only manifest',
    asset: { path: 'artwork/review.png', status: 'review' },
    provenance: { path: 'artwork/review.png', status: 'approved', license: 'ISC' },
    expected: 'review',
  },
  {
    name: 'blocked provenance dominates an approved manifest',
    asset: approvedAsset,
    provenance: { ...approvedProvenance, status: 'blocked' },
    expected: 'blocked',
  },
  {
    name: 'blocked manifest with otherwise valid provenance',
    asset: { ...approvedAsset, status: 'blocked' },
    provenance: approvedProvenance,
    expected: 'blocked',
  },
  {
    name: 'missing provenance fails closed',
    asset: approvedAsset,
    provenance: undefined,
    expected: 'unverified',
  },
  {
    name: 'provenance with a missing license fails closed',
    asset: approvedAsset,
    provenance: { path: approvedAsset.path, status: 'approved' },
    expected: 'unverified',
  },
  {
    name: 'provenance with an unknown license fails closed',
    asset: approvedAsset,
    provenance: { ...approvedProvenance, license: 'unknown' },
    expected: 'unverified',
  },
  {
    name: 'unknown manifest status fails closed',
    asset: { ...approvedAsset, status: 'pending' },
    provenance: approvedProvenance,
    expected: 'unverified',
  },
] as const;

for (const { name, asset, provenance, expected } of cases) {
  test(`asset review status: ${name}`, () => {
    expect(resolveAssetReviewStatus(asset, provenance)).toBe(expected);
  });
}

test('asset review status normalizes case and surrounding whitespace', () => {
  expect(
    resolveAssetReviewStatus(
      { ...approvedAsset, status: ' APPROVED ' },
      { ...approvedProvenance, status: ' APPROVED ', license: ' isc ' }
    )
  ).toBe('approved');
});

test('asset review status index resolves every manifest path independently', () => {
  const assets = [
    approvedAsset,
    { path: 'artwork/review.png', status: 'review' },
    { path: 'artwork/missing.png', status: 'approved' },
  ];
  const provenanceIndex = buildProvenanceIndex([
    approvedProvenance,
    { path: 'artwork/review.png', status: 'review', license: 'ISC' },
  ]);

  expect(Object.fromEntries(resolveAssetReviewStatuses(assets, provenanceIndex))).toEqual({
    'artwork/approved.png': 'approved',
    'artwork/review.png': 'review',
    'artwork/missing.png': 'unverified',
  });
});
