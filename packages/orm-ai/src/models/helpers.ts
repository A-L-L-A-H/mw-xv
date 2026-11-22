import type { BaseModel } from '@moonwitness/orm';

/** Defer target class evaluation and prevent recursive .d.ts type expansion (TS7056). */
export function modelRef(resolve: () => typeof BaseModel): () => typeof BaseModel {
  return resolve;
}
