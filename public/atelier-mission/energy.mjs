// Energy maths for Mission Control. Pure functions, no I/O, so every figure can be tested.
//
// Honesty rules the rest of the app relies on:
//   - "measured" energy is power read from the GPU driver (nvidia-smi) multiplied by the time between two readings;
//     it covers the graphics card only, not the processor, the fans of the case or the monitor.
//   - "estimated" energy is a wattage the person typed in, multiplied by the time the harness was working on a model
//     request. It is never shown as measured.
//   - a gap between readings longer than MAX_GAP_MS is not bridged: nobody was watching, so the energy is unknown.

export const MAX_GAP_MS = 30_000;
const MS_PER_HOUR = 3_600_000;

/** Common currencies with a typical household price per kWh. Typical values only: the person replaces them with the
 *  rate on their own electricity bill, and the panel says so while the default is in use. */
export const CURRENCIES = [
  {code: 'USD', name: 'US dollar', price: 0.17},
  {code: 'CAD', name: 'Canadian dollar', price: 0.15},
  {code: 'EUR', name: 'Euro', price: 0.30},
  {code: 'GBP', name: 'British pound', price: 0.28},
  {code: 'AUD', name: 'Australian dollar', price: 0.33},
  {code: 'NZD', name: 'New Zealand dollar', price: 0.32},
  {code: 'CHF', name: 'Swiss franc', price: 0.27},
  {code: 'SEK', name: 'Swedish krona', price: 2.0},
  {code: 'NOK', name: 'Norwegian krone', price: 1.6},
  {code: 'DKK', name: 'Danish krone', price: 2.9},
  {code: 'PLN', name: 'Polish zloty', price: 1.1},
  {code: 'CZK', name: 'Czech koruna', price: 6.5},
  {code: 'JPY', name: 'Japanese yen', price: 31},
  {code: 'CNY', name: 'Chinese yuan', price: 0.55},
  {code: 'INR', name: 'Indian rupee', price: 8},
  {code: 'KRW', name: 'South Korean won', price: 160},
  {code: 'BRL', name: 'Brazilian real', price: 0.9},
  {code: 'MXN', name: 'Mexican peso', price: 2.6},
  {code: 'ZAR', name: 'South African rand', price: 3.0},
  {code: 'AED', name: 'UAE dirham', price: 0.3},
];
const BY_CODE = new Map(CURRENCIES.map(entry => [entry.code, entry]));

// Keys are lower-case region codes from the browser's or the system's locale.
const REGION_CURRENCY = {
  us: 'USD', ca: 'CAD', gb: 'GBP', au: 'AUD', nz: 'NZD', ch: 'CHF', se: 'SEK', no: 'NOK', dk: 'DKK', pl: 'PLN', cz: 'CZK',
  jp: 'JPY', cn: 'CNY', in: 'INR', kr: 'KRW', br: 'BRL', mx: 'MXN', za: 'ZAR', ae: 'AED',
  de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', be: 'EUR', at: 'EUR', ie: 'EUR', pt: 'EUR', fi: 'EUR', gr: 'EUR',
};

/** The currency that goes with a locale such as "en-CA" (USD when the region is unknown). */
export function currencyForLocale(locale) {
  const region = /[-_]([A-Za-z]{2})\b/.exec(String(locale ?? ''))?.[1]?.toLowerCase();
  return (region && REGION_CURRENCY[region]) || 'USD';
}

export const defaultCurrencyPrice = code => BY_CODE.get(code)?.price ?? 0.15;

/** Largest price the panel accepts per kWh in any currency (JPY and KRW run to two or three digits). */
export const MAX_PRICE = 100_000;
export const MAX_ESTIMATED_WATTS = 5_000;

/**
 * Preferences as stored: {currency, pricePerKwh | null, estimatedWatts | null}. A null price means "use the typical
 * price for the currency"; the panel then labels the cost as based on a default.
 * @param {any} input - partial preferences from the browser or from disk.
 * @param {{currency?: string}} [fallback] - values used for fields that are missing or invalid.
 */
export function normalizePrefs(input, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const code = typeof source.currency === 'string' ? source.currency.trim().toUpperCase() : '';
  const currency = BY_CODE.has(code) ? code : (BY_CODE.has(fallback.currency) ? fallback.currency : 'USD');
  const price = source.pricePerKwh === null || source.pricePerKwh === '' || source.pricePerKwh === undefined ? null : Number(source.pricePerKwh);
  const watts = source.estimatedWatts === null || source.estimatedWatts === '' || source.estimatedWatts === undefined ? null : Number(source.estimatedWatts);
  return {
    currency,
    pricePerKwh: price !== null && Number.isFinite(price) && price >= 0 && price <= MAX_PRICE ? price : null,
    estimatedWatts: watts !== null && Number.isFinite(watts) && watts > 0 && watts <= MAX_ESTIMATED_WATTS ? Math.round(watts * 10) / 10 : null,
  };
}

/** The price per kWh in use and whether the person set it. */
export function effectivePrice(prefs) {
  const set = Number.isFinite(prefs?.pricePerKwh) && prefs.pricePerKwh !== null;
  return {price: set ? prefs.pricePerKwh : defaultCurrencyPrice(prefs?.currency), isDefault: !set};
}

/** Watt-hours for a power held for a time. */
export const wattHours = (watts, ms) => watts * ms / MS_PER_HOUR;

/** Cost of an energy amount at a price per kWh. */
export const costOf = (wh, pricePerKwh) => wh / 1000 * pricePerKwh;

/**
 * Energy between two readings.
 * @param {{fromT: number, toT: number, powerFromW: number|null, powerToW: number|null, busyMs?: number, estimatedWatts?: number|null}} interval
 *   Times in ms. busyMs is how long, inside the interval, the harness was waiting on or streaming a model reply.
 * @returns {{measuredWh: number, estimatedWh: number}} At most one of the two is non-zero.
 */
export function integrateInterval({fromT, toT, powerFromW, powerToW, busyMs = 0, estimatedWatts = null}, maxGapMs = MAX_GAP_MS) {
  const dt = toT - fromT;
  if (!(dt > 0)) return {measuredWh: 0, estimatedWh: 0};
  if (Number.isFinite(powerFromW) && Number.isFinite(powerToW)) {
    // A gap longer than maxGapMs is not bridged: the card may have idled or worked for any part of it.
    return dt <= maxGapMs ? {measuredWh: wattHours((powerFromW + powerToW) / 2, dt), estimatedWh: 0} : {measuredWh: 0, estimatedWh: 0};
  }
  if (Number.isFinite(estimatedWatts) && estimatedWatts > 0) {
    const busy = Math.min(Math.max(0, busyMs), dt);
    return {measuredWh: 0, estimatedWh: wattHours(estimatedWatts, busy)};
  }
  return {measuredWh: 0, estimatedWh: 0};
}

/** Add an interval's energy to a counter {measuredWh, estimatedWh}. Returns a new counter. */
export function addEnergy(counter, interval) {
  return {measuredWh: (counter?.measuredWh ?? 0) + (interval?.measuredWh ?? 0), estimatedWh: (counter?.estimatedWh ?? 0) + (interval?.estimatedWh ?? 0)};
}

/**
 * Turn a counter into what the panel shows: watt-hours, cost and an honest source label.
 * @param {{measuredWh: number, estimatedWh: number}} counter
 * @param {{pricePerKwh: number|null, currency: string}} prefs
 * @returns {{wh: number, kwh: number, cost: number, currency: string, source: 'measured'|'estimate'|'mixed'|'none'}}
 */
export function summarizeEnergy(counter, prefs) {
  const measured = counter?.measuredWh ?? 0, estimated = counter?.estimatedWh ?? 0;
  const wh = measured + estimated;
  const {price} = effectivePrice(prefs);
  const source = measured > 0 && estimated > 0 ? 'mixed' : measured > 0 ? 'measured' : estimated > 0 ? 'estimate' : 'none';
  return {wh, kwh: wh / 1000, cost: costOf(wh, price), currency: prefs?.currency ?? 'USD', source, measuredWh: measured, estimatedWh: estimated};
}

/** Money in the person's currency. Small amounts keep enough digits to be readable (0.0042, not 0.00). */
export function formatMoney(amount, currency = 'USD', locale) {
  if (!Number.isFinite(amount)) return '-';
  const abs = Math.abs(amount);
  const digits = abs === 0 || abs >= 1 ? undefined : abs >= 0.1 ? 3 : abs >= 0.01 ? 4 : 5;
  try {
    return new Intl.NumberFormat(locale, {style: 'currency', currency, ...(digits ? {minimumFractionDigits: digits, maximumFractionDigits: digits} : {})}).format(amount);
  } catch {
    return `${amount.toFixed(digits ?? 2)} ${currency}`;
  }
}

/** Energy for people: Wh below one kWh, kWh above. */
export function formatEnergy(wh) {
  if (!Number.isFinite(wh)) return '-';
  if (wh >= 1000) return `${(wh / 1000).toFixed(wh >= 10_000 ? 1 : 2)} kWh`;
  if (wh >= 100) return `${Math.round(wh)} Wh`;
  if (wh >= 1) return `${wh.toFixed(1)} Wh`;
  return `${wh.toFixed(2)} Wh`;
}

/** Local calendar day, YYYY-MM-DD, for the day ledger. */
export function localDay(time = Date.now()) {
  const date = new Date(time);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
