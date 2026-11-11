const test = require('node:test');
const assert = require('node:assert');
const croot = require('../croot.js');

test('urutan step diurutkan per segmen numerik', () => {
  const steps = ['3', '2.10', '1', '2', '2.2', '2.1', '10'];
  const sorted = steps
    .map(croot.parseStep)
    .sort(croot.compareStep)
    .map((s) => s.join('.'));
  assert.deepStrictEqual(sorted, ['1', '2', '2.1', '2.2', '2.10', '3', '10']);
});
