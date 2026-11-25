Found during hourly audit:

**File(s):** packages/orm-income-ledger/tests/manifest.test.ts
**Type:** non-centralized
**Suggestion:** Add test coverage for:

- All 7 adapter functions in src/adapters/*.ts (createEntryFromSale, upsertMrrFromSubscription, createEntryFromMarketplaceOrder, createEntryFromAds, createEntryFromAffiliateWebhook, createEntryFromContentRoyalty, createEntryFromDonation)
- recomputeMetrics edge cases (multiple periods, dead streams, cost/fee/tax entries)
- HTTP plugin routes (auth, validation, success/error responses)
- computeAllocationSplit edge cases (over 100%, negative, all inactive)
  Only 1 test file exists with minimal coverage.
