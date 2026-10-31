import { closeServer } from './helpers.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, percentOf, allocate, toCents, fromCents } from '../src/lib/money.js';
import { periodStart, addMonthsClamped, paymentTermDays } from '../src/lib/dates.js';
import { validatePassword } from '../src/middleware/auth.js';
import { calculateInvoice } from '../src/services/invoiceCalculator.js';
import { TaxTable } from '../src/services/taxEngine.js';

after(closeServer);

test('money: user amounts parse exactly, without float error', () => {
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney(0.3), 30);
  assert.equal(parseMoney('1560'), 156000);
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('1.234'), null); // more than 2 decimals is rejected, never rounded silently
  assert.equal(parseMoney('-5'), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(toCents(fromCents(1999)), 1999);
});

test('money: percentages round HALF_UP at the cent', () => {
  assert.equal(percentOf(25, 18), 5);      // 4.5 cents -> 5
  assert.equal(percentOf(24, 18), 4);      // 4.32 -> 4
  assert.equal(percentOf(4, 12.5), 1);     // 0.5 cent -> 1
  assert.equal(percentOf(3, 12.5), 0);     // 0.375 -> 0
  assert.equal(percentOf(100000, 18), 18000);
  assert.equal(percentOf(1999, 5), 100);   // 99.95 -> 100
});

test('money: allocation never loses or invents a cent', () => {
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  const skew = allocate(999, [3333, 3333, 3334]);
  assert.equal(skew.reduce((a, b) => a + b, 0), 999);
});

test('invoice: classic float traps foot exactly (3 x 33.33 at 18%, 0.1 + 0.2 style prices)', () => {
  const taxes = new TaxTable([{ id: 1, name: 'GST', rate_percentage: 18, is_default: 1, is_active: 1 }]);
  const calc = calculateInvoice(
    [
      { productId: 1, variantId: null, description: 'a', quantity: 3, unitPriceCents: 3333, taxId: 1 },
      { productId: 2, variantId: null, description: 'b', quantity: 1, unitPriceCents: 10, taxId: 1 },
      { productId: 3, variantId: null, description: 'c', quantity: 1, unitPriceCents: 20, taxId: 1 }
    ],
    taxes, null, '2026-01-01'
  );
  assert.equal(calc.subtotalCents, 9999 + 10 + 20);
  // per-line tax: 1799.82 -> 1800 (rounded 17.9982 => 18.00), 1.8 -> 2, 3.6 -> 4  (cents: 1800, 2, 4)
  assert.deepEqual(calc.lines.map(l => l.taxCents), [1800, 2, 4]);
  assert.equal(calc.taxCents, 1806);
  assert.equal(calc.totalCents, calc.subtotalCents - calc.discountCents + calc.taxCents);
  assert.equal(calc.totalCents, calc.lines.reduce((s, l) => s + l.totalCents, 0));
});

test('dates: month-end billing never drifts (31 Jan monthly)', () => {
  assert.equal(periodStart('2026-01-31', 'monthly', 0), '2026-01-31');
  assert.equal(periodStart('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(periodStart('2026-01-31', 'monthly', 2), '2026-03-31'); // not 03-28
  assert.equal(periodStart('2026-01-31', 'monthly', 3), '2026-04-30');
  assert.equal(periodStart('2024-01-31', 'monthly', 1), '2024-02-29'); // leap year
});

test('dates: yearly, weekly, daily cadences incl. leap day', () => {
  assert.equal(periodStart('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(periodStart('2024-02-29', 'yearly', 4), '2028-02-29');
  assert.equal(periodStart('2026-12-31', 'monthly', 2), '2027-02-28');
  assert.equal(periodStart('2026-03-01', 'weekly', 2), '2026-03-15');
  assert.equal(periodStart('2026-02-27', 'daily', 2), '2026-03-01');
  assert.equal(addMonthsClamped('2026-11-30', 3), '2027-02-28');
});

test('dates: payment terms', () => {
  assert.equal(paymentTermDays('30 Days Net'), 30);
  assert.equal(paymentTermDays('Immediate Payment'), 0);
});

test('password policy: more than 8 chars, upper, lower, special; digits not required', () => {
  const ok = (p: string) => validatePassword(p).valid;
  assert.equal(ok('Abcdefgh!'), true);        // 9 chars
  assert.equal(ok('Abcdefg!'), false);        // 8 chars
  assert.equal(ok('abcdefgh!'), false);       // no uppercase
  assert.equal(ok('ABCDEFGH!'), false);       // no lowercase
  assert.equal(ok('Abcdefghi'), false);       // no special
  assert.equal(ok('Abcdefgh 1'), false);      // space and digit are not special characters
  assert.equal(ok('Abcdefg12345'), false);    // digits are not special
  assert.equal(ok('Abcdef 1!'), true);        // 9 chars with a real special character
  assert.equal(ok('Abcdefgh!' + 'x'.repeat(60)), false); // over 64
});
