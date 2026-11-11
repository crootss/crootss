import test from 'node:test';
import assert from 'node:assert';
import { parseStep, compareStep } from '../croot.js';

test('urutan step diurutkan per segmen numerik', () => {
  const steps = ['3', '2.10', '1', '2', '2.2', '2.1', '10'];
  const sorted = steps.map(parseStep).sort(compareStep).map((s) => s.join('.'));
  assert.deepStrictEqual(sorted, ['1', '2', '2.1', '2.2', '2.10', '3', '10']);
});
