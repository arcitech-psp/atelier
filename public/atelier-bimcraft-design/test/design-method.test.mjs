import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDesign, validateDesign } from '../at-bimcraft-design.mjs';
import { roofProfiles, selectParti, selectRoof } from '../design-method.mjs';

test('selects supported design forms and refuses unsupported fallback geometry', () => {
  assert.equal(generateDesign({ brief: 'Two-storey L-plan courtyard house, two bedrooms' }).parti, 'courtyard-sawtooth');
  assert.equal(selectParti({ site: { grade_drop_mm: 1200 } }).selected, 'terraced-split-level');
  assert.throws(() => generateDesign({ brief: 'Two-storey home with three bedrooms' }), /supports two storeys and two bedrooms/);
});

test('north rotation preserves area and facade ratios', () => {
  const base = generateDesign();
  const rotated = generateDesign({ site: { north_deg: 31 } });
  assert.notDeepEqual(base.walls[0].b, rotated.walls[0].b);
  assert.equal(rotated.preflight.ok, true);
  assert.ok(Math.abs(base.preflight.areas['Upper Floor'].usable_slab_m2 - rotated.preflight.areas['Upper Floor'].usable_slab_m2) < 0.01);
});

test('roof compiler makes distinct profiles and holds cold-climate butterfly requests', () => {
  const butterfly = roofProfiles({ form: 'butterfly' })[0].extrusion.profile;
  const gable = roofProfiles({ form: 'gable' })[0].extrusion.profile;
  assert.ok(butterfly[1][1] < butterfly[0][1] && butterfly[1][1] < butterfly[2][1]);
  assert.ok(gable[1][1] > gable[0][1] && gable[1][1] > gable[2][1]);
  assert.equal(selectRoof({ brief: 'butterfly roof', site: { climate: 'cold-snow' } }).hold_points.length, 1);
});

test('validation catches damaged openings and missing volumes before construction', () => {
  const design = generateDesign();
  design.openings[0].at = [999999, 0];
  design.volumes.splice(1);
  const report = validateDesign(design);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('opening')));
  assert.ok(report.errors.some((error) => error.includes('volumes')));
});
