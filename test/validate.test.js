import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../validate.js';

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url)));
const run = (message, lines) => validate(message, { lines }, catalog);

test('clean order is confirmed and priced from the catalog', () => {
  const r = run('2 meat pies and a dozen doughnuts pls', [
    { quote: '2 meat pies', item: 'meat pies', quantity: 2, unit: null },
    { quote: 'a dozen doughnuts', item: 'doughnuts', quantity: 1, unit: 'dozen', price: 0.01 },
  ]);
  assert.equal(r.held.length, 0);
  assert.deepEqual(r.confirmed.map(l => [l.id, l.pieces]), [['meat-pie', 2], ['doughnut', 12]]);
  assert.equal(r.total, 12); // model's price ignored
});

test('quantity not written in the message is held', () => {
  const r = run('send meat pies', [{ quote: 'meat pies', item: 'meat pies', quantity: 3, unit: null }]);
  assert.equal(r.confirmed.length, 0);
  assert.match(r.held[0].question, /how many/i);
});

test('vague quantity is held', () => {
  const r = run('some doughnuts', [{ quote: 'some doughnuts', item: 'doughnuts', quantity: 5, unit: null }]);
  assert.equal(r.confirmed.length, 0);
});

test('quote the model invented is held', () => {
  const r = run('2 meat pies', [{ quote: '4 meat pies', item: 'meat pies', quantity: 4, unit: null }]);
  assert.equal(r.confirmed.length, 0);
});

test('ambiguous item asks which one', () => {
  const r = run('3 pies', [{ quote: '3 pies', item: 'pies', quantity: 3, unit: null }]);
  assert.equal(r.confirmed.length, 0);
  assert.match(r.held[0].question, /Meat pie.*Chicken pie/);
});

test('item not on the price list is held', () => {
  const r = run('2 croissants', [{ quote: '2 croissants', item: 'croissants', quantity: 2, unit: null }]);
  assert.equal(r.confirmed.length, 0);
  assert.match(r.held[0].question, /croissants/);
});

test('unit the item is not sold in is held', () => {
  const r = run('2 dozen big loaf', [{ quote: '2 dozen big loaf', item: 'big loaf', quantity: 2, unit: 'dozen' }]);
  assert.equal(r.confirmed.length, 0);
});

test('unit written in the message but dropped by the model is held', () => {
  const r = run('2 dozen meat pies', [{ quote: '2 dozen meat pies', item: 'meat pies', quantity: 2, unit: 'piece' }]);
  assert.equal(r.confirmed.length, 0);
});

test('line the model skipped is held, not silently lost', () => {
  const r = run('2 meat pies and 3 cupcakes', [{ quote: '2 meat pies', item: 'meat pies', quantity: 2, unit: null }]);
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.held.length, 1);
  assert.match(r.held[0].quote, /3 cupcakes/);
});

test('number words count as written quantities', () => {
  const r = run('two boxes of doughnuts', [{ quote: 'two boxes of doughnuts', item: 'doughnuts', quantity: 2, unit: 'box' }]);
  assert.equal(r.confirmed[0].pieces, 12);
});

test('number that is not a quantity of the item is held', () => {
  const r = run('cupcakes for 10 people', [{ quote: 'cupcakes for 10 people', item: 'cupcakes', quantity: 10, unit: null }]);
  assert.equal(r.confirmed.length, 0);
});

test('two candidate numbers are held', () => {
  const r = run('2 or 3 chicken pies', [{ quote: '2 or 3 chicken pies', item: 'chicken pies', quantity: 3, unit: null }]);
  assert.equal(r.confirmed.length, 0);
});

test('hedged quantity is held even when the model drops the hedge', () => {
  const r = run('maybe 4 doughnuts, not sure yet', [{ quote: '4 doughnuts', item: 'doughnuts', quantity: 4, unit: null }]);
  assert.equal(r.confirmed.length, 0);
});

test('message with no order at all is held, not an empty success', () => {
  const r = run('same as last time', []);
  assert.equal(r.held.length, 1);
});

test('half a dozen is six', () => {
  const r = run('half a dozen cupcakes', [{ quote: 'half a dozen cupcakes', item: 'cupcakes', quantity: 0.5, unit: 'dozen' }]);
  assert.equal(r.confirmed[0].pieces, 6);
});

test('quantity the model left null is read from the quote when only one is written', () => {
  const r = run('also a big loaf', [{ quote: 'a big loaf', item: 'big loaf', quantity: null, unit: null }]);
  assert.equal(r.confirmed[0].pieces, 1);
});

test('chat around the order is not flagged as a skipped line', () => {
  const r = run("my sister said your pies are the best. 3 meat pies, I'll pick up by 6", [
    { quote: '3 meat pies', item: 'meat pies', quantity: 3, unit: null }]);
  assert.equal(r.held.length, 0);
});

test('typo is held with a suggestion, never auto-corrected', () => {
  const r = run('3 doughnts', [{ quote: '3 doughnts', item: 'doughnts', quantity: 3, unit: null }]);
  assert.equal(r.confirmed.length, 0);
  assert.match(r.held[0].question, /Did you mean doughnuts\?/);
});

test('malformed extraction holds the whole message', () => {
  const r = validate('2 meat pies', null, catalog);
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.held.length, 1);
});
