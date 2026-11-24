import { describe, expect, it } from 'vitest';
import { computeAllocationSplit } from '../src/index.js';

describe('computeAllocationSplit edge cases', () => {
  const baseStream = {
    id: 'stream-1',
    kind: 'saas',
    status: 'live',
    goalMonthlyMinor: 500_000,
  };

  it('handles over 100% total allocations', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 80, isActive: true },
      { target: 'savings', percentage: 50, isActive: true },
      { target: 'tax', percentage: 30, isActive: true },
    ]);

    expect(split.reinvest).toBe(80);
    expect(split.savings).toBe(50);
    expect(split.tax).toBe(30);
    expect(split.charity).toBe(0);
    expect(split.personal).toBe(0);
    // Total can exceed 100% - the function just sums active ones
    expect(split.reinvest + split.savings + split.tax).toBe(160);
  });

  it('handles negative percentages (treats as negative contribution)', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 100, isActive: true },
      { target: 'savings', percentage: -20, isActive: true },
      { target: 'tax', percentage: 20, isActive: true },
    ]);

    expect(split.reinvest).toBe(100);
    expect(split.savings).toBe(-20);
    expect(split.tax).toBe(20);
  });

  it('handles all inactive allocations (returns all zeros)', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 50, isActive: false },
      { target: 'savings', percentage: 30, isActive: false },
      { target: 'charity', percentage: 10, isActive: false },
      { target: 'personal', percentage: 5, isActive: false },
      { target: 'tax', percentage: 5, isActive: false },
    ]);

    expect(split).toEqual({
      reinvest: 0,
      savings: 0,
      charity: 0,
      personal: 0,
      tax: 0,
    });
  });

  it('handles mixed active/inactive correctly', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 40, isActive: true },
      { target: 'savings', percentage: 30, isActive: false },
      { target: 'charity', percentage: 10, isActive: true },
      { target: 'personal', percentage: 5, isActive: false },
      { target: 'tax', percentage: 15, isActive: true },
    ]);

    expect(split).toEqual({
      reinvest: 40,
      savings: 0,
      charity: 10,
      personal: 0,
      tax: 15,
    });
  });

  it('handles zero percentage active allocation', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 0, isActive: true },
      { target: 'savings', percentage: 100, isActive: true },
    ]);

    expect(split.reinvest).toBe(0);
    expect(split.savings).toBe(100);
  });

  it('handles empty allocations array', () => {
    const split = computeAllocationSplit(baseStream, []);
    expect(split).toEqual({
      reinvest: 0,
      savings: 0,
      charity: 0,
      personal: 0,
      tax: 0,
    });
  });

  it('handles decimal percentages', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 33.33, isActive: true },
      { target: 'savings', percentage: 33.33, isActive: true },
      { target: 'tax', percentage: 33.34, isActive: true },
    ]);

    expect(split.reinvest).toBe(33.33);
    expect(split.savings).toBe(33.33);
    expect(split.tax).toBe(33.34);
  });

  it('handles large percentage values', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 1000, isActive: true },
      { target: 'savings', percentage: 500, isActive: true },
    ]);

    expect(split.reinvest).toBe(1000);
    expect(split.savings).toBe(500);
  });

  it('handles all five targets', () => {
    const split = computeAllocationSplit(baseStream, [
      { target: 'reinvest', percentage: 20, isActive: true },
      { target: 'savings', percentage: 20, isActive: true },
      { target: 'charity', percentage: 20, isActive: true },
      { target: 'personal', percentage: 20, isActive: true },
      { target: 'tax', percentage: 20, isActive: true },
    ]);

    expect(split).toEqual({
      reinvest: 20,
      savings: 20,
      charity: 20,
      personal: 20,
      tax: 20,
    });
  });
});
