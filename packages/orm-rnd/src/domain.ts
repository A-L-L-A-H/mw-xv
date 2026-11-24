import { RndHypothesisStatus } from './models.js';

const HYPOTHESIS_TRANSITIONS = new Set([
  `${RndHypothesisStatus.PROPOSED}>${RndHypothesisStatus.TESTABLE}`,
  `${RndHypothesisStatus.PROPOSED}>${RndHypothesisStatus.REFUTED}`,
  `${RndHypothesisStatus.TESTABLE}>${RndHypothesisStatus.SUPPORTED}`,
  `${RndHypothesisStatus.TESTABLE}>${RndHypothesisStatus.REJECTED}`,
  `${RndHypothesisStatus.TESTABLE}>${RndHypothesisStatus.REFUTED}`,
]);

export function canTransitionHypothesis(transition: { from: string; to: string }): boolean {
  return HYPOTHESIS_TRANSITIONS.has(`${transition.from}>${transition.to}`);
}

export function validateTrl(prototypeTrl: number | null): { valid: boolean; reason: string | null } {
  if (prototypeTrl === null || !Number.isInteger(prototypeTrl)) {
    return { valid: false, reason: 'TRL must be an integer between 1 and 9' };
  }
  if (prototypeTrl < 1 || prototypeTrl > 9) {
    return { valid: false, reason: 'TRL must be an integer between 1 and 9' };
  }
  return { valid: true, reason: null };
}