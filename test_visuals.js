const {test} = require('node:test');
const assert = require('node:assert/strict');
const {funnelCounts, render} = require('./visuals.js');

test('conditional rates apply to survivors and retain precision between gates', () => {
  assert.deepEqual(funnelCounts(100, [.8, .5, .75]), [100, 80, 40, 30]);
  const counts = funnelCounts(100, [.7, .33, .275]);
  assert.ok(Math.abs(counts[3] - 6.3525) < 1e-12);
  assert.deepEqual(funnelCounts(100, [.8, 0, 1]), [100, 80, 0, 0]);
  assert.deepEqual(funnelCounts(100, [1, 1, 1]), [100, 100, 100, 100]);
});

test('changing a gate preserves earlier counts and propagates to later counts', () => {
  const base = funnelCounts(100, [.8, .5, .75]);
  const changed = funnelCounts(100, [.8, .75, .75]);
  assert.deepEqual(changed.slice(0, 2), base.slice(0, 2));
  assert.equal(changed[2], 60);
  assert.equal(changed[3], 45);
});

test('invalid numeric inputs fail rather than render misleading geometry', () => {
  for (const initial of [0, -1, NaN, Infinity]) assert.throws(() => funnelCounts(initial, [.5]));
  for (const rates of [[], [-.1], [1.1], [NaN], [Infinity]]) assert.throws(() => funnelCounts(100, rates));
});

test('source strings cannot turn visual labels into markup', () => {
  const html = render({kind:'flow', title:'<script>bad()</script>', caption:'<img onerror="bad()">',
    nodes:[{label:'<input>',detail:'<iframe>',step:0},{label:'B',detail:'C',step:1}]}, 0, 'sample', 3);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<input>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
