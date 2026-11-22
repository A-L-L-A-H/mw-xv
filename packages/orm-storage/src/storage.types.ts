import type { Readable } from 'node:stream';

export interface StoredObjectMetadata {
  readonly key: string;
  readonly sizeBytes: number;
  readonly checksum?: string;
  readonly lastModified?: Date;
}

export interface AttachmentStorage {
  checkReady?(): Promise<void>;
  put(key: string, content: Uint8Array): Promise<StoredObjectMetadata>;
  get(key: string): Promise<Buffer | null>;
  putStream?(key: string, content: Readable, maxBytes?: number): Promise<StoredObjectMetadata>;
  getStream?(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  list(): AsyncIterable<StoredObjectMetadata>;
}
