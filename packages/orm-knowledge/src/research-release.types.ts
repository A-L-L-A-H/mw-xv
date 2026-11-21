export interface ResearchGraphRecordInput {
  readonly key: string;
  readonly kind: 'node' | 'source' | 'expression' | 'assertion' | 'evidence' | 'relation';
  readonly visibility: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  readonly content: unknown;
}

export interface CreateResearchGraphReleaseInput {
  readonly corpusKey: string;
  readonly schemaVersion: string;
  readonly records: readonly ResearchGraphRecordInput[];
  readonly previousReleaseDigest?: string | null;
}

export interface StoredResearchGraphRecord extends ResearchGraphRecordInput {
  readonly contentDigest: string;
}

export interface StoredResearchGraphRelease {
  readonly corpusKey: string;
  readonly releaseDigest: string;
  readonly manifestDigest: string;
  readonly manifestJson: string;
  readonly schemaVersion: string;
  readonly previousReleaseDigest: string | null;
  readonly records: readonly StoredResearchGraphRecord[];
}
