import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Resolve the data root while supporting the container layout (`/app/corpus`). */
export function resolveCorpusDataRoot(): string {
  const corpusDirectory = process.env.MOONWITNESS_CORPUS_ROOT;
  return corpusDirectory ? path.dirname(path.resolve(corpusDirectory)) : repositoryRoot;
}
