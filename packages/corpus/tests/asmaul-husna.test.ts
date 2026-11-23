import { describe, expect, it } from 'vitest';
import {
  ASMAUL_HUSNA_CONCEPT_EDGES,
  ASMAUL_HUSNA_DATASET,
  getAsmaulHusnaByCluster,
  getAsmaulHusnaByOrdinal,
  getRelatedAsmaulHusna,
  searchAsmaulHusna,
  summarizeAsmaulHusnaClusters,
} from '../src/asmaul-husna.js';

describe('asmaul-husna canonical dataset (Wave F.32)', () => {
  it('contains exactly 99 entries with unique sequential ordinals 1..99 and complete fields', () => {
    expect(ASMAUL_HUSNA_DATASET).toHaveLength(99);

    const ordinals = new Set<number>();
    for (let i = 0; i < ASMAUL_HUSNA_DATASET.length; i += 1) {
      const entry = ASMAUL_HUSNA_DATASET[i]!;
      expect(entry.ordinal).toBe(i + 1);
      ordinals.add(entry.ordinal);
      expect(entry.arabic.trim().length).toBeGreaterThan(0);
      expect(entry.transliteration.trim().length).toBeGreaterThan(0);
      expect(entry.meaningEn.trim().length).toBeGreaterThan(0);
      expect(entry.meaningId.trim().length).toBeGreaterThan(0);
    }
    expect(ordinals.size).toBe(99);
  });

  it('has valid concept graph edges referencing ordinals 1..99 without self-loops', () => {
    expect(ASMAUL_HUSNA_CONCEPT_EDGES.length).toBeGreaterThanOrEqual(20);
    for (const edge of ASMAUL_HUSNA_CONCEPT_EDGES) {
      expect(edge.fromOrdinal).toBeGreaterThanOrEqual(1);
      expect(edge.fromOrdinal).toBeLessThanOrEqual(99);
      expect(edge.toOrdinal).toBeGreaterThanOrEqual(1);
      expect(edge.toOrdinal).toBeLessThanOrEqual(99);
      expect(edge.fromOrdinal).not.toBe(edge.toOrdinal);
      expect(getAsmaulHusnaByOrdinal(edge.fromOrdinal)).toBeDefined();
      expect(getAsmaulHusnaByOrdinal(edge.toOrdinal)).toBeDefined();
    }
  });

  it('supports lookup by ordinal, cluster, search (Arabic/EN/ID), and related attributes', () => {
    expect(getAsmaulHusnaByOrdinal(1)?.transliteration).toBe('Ar-Rahman');
    expect(getAsmaulHusnaByOrdinal(99)?.transliteration).toBe('As-Sabur');

    const mercy = getAsmaulHusnaByCluster('Mercy');
    expect(mercy.length).toBeGreaterThan(5);

    expect(searchAsmaulHusna('Pengasih').some((e) => e.ordinal === 1)).toBe(true);
    expect(searchAsmaulHusna('All-Knowing').some((e) => e.ordinal === 19)).toBe(true);
    expect(searchAsmaulHusna('النُّورُ').some((e) => e.ordinal === 93)).toBe(true);

    const relatedToRahman = getRelatedAsmaulHusna(1);
    expect(relatedToRahman.map((e) => e.ordinal)).toContain(2);

    const summary = summarizeAsmaulHusnaClusters();
    const total = Object.values(summary).reduce((acc, n) => acc + n, 0);
    expect(total).toBe(99);
  });
});
