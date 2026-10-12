import test from 'node:test';
import assert from 'node:assert/strict';
import {admitScene, unitsOf} from '../index.mjs';

const lot = {label: 'Lot 10.0 m x 25.0 m', x: 0, y: 0, width: 10, height: 25};
const garage = {label: 'Garage 3.5 x 6.0', x: 1, y: 7, width: 3.5, height: 6};
const living = {label: 'Living', x: 4.5, y: 13, width: 4.5, height: 6};

test('a plan in metres is recognised with or without units', () => {
  assert.equal(unitsOf({title: 'Plan', units: 'm', cards: [lot]}), 'm');
  assert.equal(unitsOf({title: 'Plan', cards: [lot, garage, living]}), 'm');
  assert.equal(unitsOf({title: 'Steps', cards: [{label: 'Brief'}, {label: 'Massing'}]}), 'px');
  assert.equal(unitsOf({title: 'Diagram', cards: [{label: 'A', x: 24, y: 24, width: 230, height: 160}]}), 'px');
  assert.equal(unitsOf({title: 'Forced', units: 'px', cards: [lot]}), 'px');
});

test('metre plans keep small sizes and list unplaced notes beside the drawing', () => {
  const scene = admitScene({title: 'Plan', units: 'm', cards: [lot, garage, {label: 'Closet', x: 4, y: 7, width: 0.6, height: 0.9}, {label: 'Assumptions', note: 'Setbacks unverified.'}]});
  assert.equal(scene.units, 'm');
  assert.equal(scene.cards[2].width, 0.6);
  assert.equal(scene.cards[3].placed, false);
  assert.equal(scene.cards[0].placed, undefined);
  // A label edit from the panel sends the stored cards back; the unplaced note stays unplaced.
  const again = admitScene({...scene, cards: scene.cards.map(c => c.id === '0' ? {...c, label: 'Lot'} : c)});
  assert.equal(again.cards[3].placed, false);
  assert.equal(again.units, 'm');
});

test('pixel diagrams behave as before', () => {
  const scene = admitScene({title: 'Steps', cards: [{label: 'Brief'}, {label: 'Massing'}]});
  assert.equal(scene.units, 'px');
  assert.deepEqual([scene.cards[1].x, scene.cards[1].y, scene.cards[1].width], [274, 24, 230]);
  assert.throws(() => admitScene({title: 'Bad', units: 'ft', cards: [lot]}), /units/);
});
