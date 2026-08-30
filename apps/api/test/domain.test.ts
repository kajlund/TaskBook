import { describe, expect, it } from 'vitest';
import { createCollectionSchema, updateCollectionSchema } from '@waymark/contracts';
import { assertAcyclic } from '../src/domain/dependencies.js';
import { calculateProgress, isPhaseComplete } from '../src/domain/progress.js';
import { validateReorder } from '../src/domain/ordering.js';
describe('domain rules', () => {
  it('creates valid flat and phased collection inputs', () => {
    expect(createCollectionSchema.parse({ name: ' Personal ', structure: 'FLAT' }).name).toBe(
      'Personal',
    );
    expect(createCollectionSchema.parse({ name: 'Launch', structure: 'PHASED' }).structure).toBe(
      'PHASED',
    );
  });

  it('rejects blank names and invalid collection dates', () => {
    expect(() => createCollectionSchema.parse({ name: '   ', structure: 'FLAT' })).toThrow();
    expect(() =>
      createCollectionSchema.parse({
        name: 'Schedule',
        structure: 'FLAT',
        startDate: '2026-09-10',
        targetEndDate: '2026-09-01',
      }),
    ).toThrow(/Target end date/);
  });

  it('allows collection structure updates', () => {
    expect(updateCollectionSchema.parse({ structure: 'PHASED' })).toEqual({
      structure: 'PHASED',
    });
  });
  it('returns zero progress for no active tasks', () =>
    expect(calculateProgress([])).toEqual({ completed: 0, total: 0, ratio: 0 }));
  it('does not complete an empty phase', () => expect(isPhaseComplete([])).toBe(false));
  it('excludes archived tasks', () =>
    expect(
      calculateProgress([
        { completedAt: null, archivedAt: new Date() },
        { completedAt: new Date(), archivedAt: null },
      ]).ratio,
    ).toBe(1));
  it('rejects self dependencies', () =>
    expect(() => assertAcyclic('a', 'a', [])).toThrow(/itself/));
  it('rejects cycles', () =>
    expect(() =>
      assertAcyclic('c', 'a', [
        { taskId: 'a', dependsOnTaskId: 'b' },
        { taskId: 'b', dependsOnTaskId: 'c' },
      ]),
    ).toThrow(/cycle/));
  it('normalizes ordering', () =>
    expect(validateReorder(['a', 'b'], ['b', 'a'])).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]));
  it('rejects incomplete reorder scopes', () =>
    expect(() => validateReorder(['a', 'b'], ['a'])).toThrow());
});
