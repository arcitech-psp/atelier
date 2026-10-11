import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  CURRENCIES, MAX_GAP_MS, addEnergy, costOf, currencyForLocale, defaultCurrencyPrice, effectivePrice, formatEnergy, formatMoney,
  integrateInterval, localDay, normalizePrefs, summarizeEnergy, wattHours,
} from '../energy.mjs';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('watt-hours and cost: 300 W for one hour is 300 Wh, 0.3 kWh', () => {
  near(wattHours(300, 3_600_000), 300);
  near(wattHours(200, 1_800_000), 100);
  near(costOf(1000, 0.25), 0.25);
  near(costOf(300, 0.2), 0.06);
  near(costOf(0, 0.2), 0);
});

test('measured energy: trapezoid between two power readings', () => {
  // 100 W then 300 W over 10 s: mean 200 W x 10 s = 0.5556 Wh
  const energy = integrateInterval({fromT: 0, toT: 10_000, powerFromW: 100, powerToW: 300});
  near(energy.measuredWh, 200 * 10 / 3600);
  assert.equal(energy.estimatedWh, 0);
});

test('a gap longer than 30 s is not bridged', () => {
  const energy = integrateInterval({fromT: 0, toT: MAX_GAP_MS + 1, powerFromW: 300, powerToW: 300});
  assert.deepEqual(energy, {measuredWh: 0, estimatedWh: 0});
  const edge = integrateInterval({fromT: 0, toT: MAX_GAP_MS, powerFromW: 300, powerToW: 300});
  assert.ok(edge.measuredWh > 0);
});

test('no time or backwards time gives nothing', () => {
  assert.deepEqual(integrateInterval({fromT: 5, toT: 5, powerFromW: 1, powerToW: 1}), {measuredWh: 0, estimatedWh: 0});
  assert.deepEqual(integrateInterval({fromT: 9, toT: 5, powerFromW: 1, powerToW: 1}), {measuredWh: 0, estimatedWh: 0});
});

test('estimate: typed watts x busy time only, and labelled as an estimate', () => {
  // 150 W while the harness was busy for 20 s of a 30 s interval
  const energy = integrateInterval({fromT: 0, toT: 30_000, powerFromW: null, powerToW: null, busyMs: 20_000, estimatedWatts: 150});
  near(energy.estimatedWh, 150 * 20 / 3600);
  assert.equal(energy.measuredWh, 0);
  // busy time can never exceed the interval
  const capped = integrateInterval({fromT: 0, toT: 10_000, powerFromW: null, powerToW: null, busyMs: 99_000, estimatedWatts: 100});
  near(capped.estimatedWh, 100 * 10 / 3600);
  // an estimate may span a gap: the busy time is known from the harness itself
  const longGap = integrateInterval({fromT: 0, toT: 120_000, powerFromW: null, powerToW: null, busyMs: 60_000, estimatedWatts: 120});
  near(longGap.estimatedWh, 2);
});

test('no power reading and no estimate: nothing is invented', () => {
  assert.deepEqual(integrateInterval({fromT: 0, toT: 10_000, powerFromW: null, powerToW: null, busyMs: 10_000}), {measuredWh: 0, estimatedWh: 0});
  assert.deepEqual(integrateInterval({fromT: 0, toT: 10_000, powerFromW: 100, powerToW: null, busyMs: 10_000, estimatedWatts: null}), {measuredWh: 0, estimatedWh: 0});
});

test('a power reading wins over the estimate for the same interval', () => {
  const energy = integrateInterval({fromT: 0, toT: 10_000, powerFromW: 100, powerToW: 100, busyMs: 10_000, estimatedWatts: 500});
  assert.equal(energy.estimatedWh, 0);
  assert.ok(energy.measuredWh > 0);
});

test('counters add up and summaries label their source', () => {
  const prefs = {currency: 'USD', pricePerKwh: 0.5};
  let counter = {measuredWh: 0, estimatedWh: 0};
  assert.equal(summarizeEnergy(counter, prefs).source, 'none');
  counter = addEnergy(counter, {measuredWh: 400, estimatedWh: 0});
  let summary = summarizeEnergy(counter, prefs);
  assert.equal(summary.source, 'measured'); near(summary.kwh, 0.4); near(summary.cost, 0.2);
  counter = addEnergy(counter, {measuredWh: 0, estimatedWh: 100});
  summary = summarizeEnergy(counter, prefs);
  assert.equal(summary.source, 'mixed'); near(summary.wh, 500); near(summary.cost, 0.25);
  assert.equal(summarizeEnergy({measuredWh: 0, estimatedWh: 50}, prefs).source, 'estimate');
});

test('the price selector: own price wins, otherwise the typical price of the currency is flagged as a default', () => {
  assert.deepEqual(effectivePrice({currency: 'EUR', pricePerKwh: 0.41}), {price: 0.41, isDefault: false});
  assert.deepEqual(effectivePrice({currency: 'EUR', pricePerKwh: null}), {price: defaultCurrencyPrice('EUR'), isDefault: true});
  assert.equal(effectivePrice({currency: 'XYZ', pricePerKwh: null}).isDefault, true);
  // a price of zero is a real choice (free solar), not "unset"
  assert.deepEqual(effectivePrice({currency: 'USD', pricePerKwh: 0}), {price: 0, isDefault: false});
  near(summarizeEnergy({measuredWh: 1000, estimatedWh: 0}, {currency: 'JPY', pricePerKwh: null}).cost, defaultCurrencyPrice('JPY'));
});

test('preferences are validated, never trusted', () => {
  assert.deepEqual(normalizePrefs({currency: 'cad', pricePerKwh: '0.229', estimatedWatts: '250'}), {currency: 'CAD', pricePerKwh: 0.229, estimatedWatts: 250});
  assert.equal(normalizePrefs({currency: 'ZZZ'}).currency, 'USD');
  assert.equal(normalizePrefs({currency: 'ZZZ'}, {currency: 'GBP'}).currency, 'GBP');
  assert.equal(normalizePrefs({pricePerKwh: -1}).pricePerKwh, null);
  assert.equal(normalizePrefs({pricePerKwh: 'abc'}).pricePerKwh, null);
  assert.equal(normalizePrefs({pricePerKwh: ''}).pricePerKwh, null);
  assert.equal(normalizePrefs({pricePerKwh: 1e9}).pricePerKwh, null);
  assert.equal(normalizePrefs({pricePerKwh: 0}).pricePerKwh, 0);
  assert.equal(normalizePrefs({estimatedWatts: 0}).estimatedWatts, null);
  assert.equal(normalizePrefs({estimatedWatts: 99999}).estimatedWatts, null);
  assert.deepEqual(normalizePrefs(null), {currency: 'USD', pricePerKwh: null, estimatedWatts: null});
  assert.deepEqual(normalizePrefs('junk'), {currency: 'USD', pricePerKwh: null, estimatedWatts: null});
});

test('every currency in the selector has a code and a positive typical price', () => {
  assert.ok(CURRENCIES.length >= 15);
  for (const entry of CURRENCIES) {
    assert.match(entry.code, /^[A-Z]{3}$/);
    assert.ok(entry.price > 0, entry.code);
    assert.doesNotThrow(() => new Intl.NumberFormat('en', {style: 'currency', currency: entry.code}).format(1), entry.code);
  }
  assert.equal(new Set(CURRENCIES.map(entry => entry.code)).size, CURRENCIES.length);
});

test('locale decides the starting currency', () => {
  assert.equal(currencyForLocale('en-CA'), 'CAD');
  assert.equal(currencyForLocale('de-DE'), 'EUR');
  assert.equal(currencyForLocale('en_GB'), 'GBP');
  assert.equal(currencyForLocale('en'), 'USD');
  assert.equal(currencyForLocale(undefined), 'USD');
});

test('money and energy are formatted for people', () => {
  assert.match(formatMoney(1.5, 'USD', 'en-US'), /\$1\.50/);
  assert.match(formatMoney(0.0042, 'USD', 'en-US'), /\$0\.0042/);
  assert.match(formatMoney(0.5, 'CAD', 'en-US'), /0\.500/);
  assert.equal(formatMoney(NaN), '-');
  assert.equal(formatEnergy(0.123), '0.12 Wh');
  assert.equal(formatEnergy(12.34), '12.3 Wh');
  assert.equal(formatEnergy(456.7), '457 Wh');
  assert.equal(formatEnergy(2500), '2.50 kWh');
  assert.equal(formatEnergy(25000), '25.0 kWh');
});

test('local day key', () => {
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDay(new Date(2026, 9, 12, 0, 0, 1).getTime()), '2026-10-12');
  assert.equal(localDay(new Date(2026, 9, 11, 23, 59, 59).getTime()), '2026-10-11');
});
