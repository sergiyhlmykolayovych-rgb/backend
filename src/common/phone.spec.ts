import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['+380 (50) 123-45-67', '+380501234567'],
    ['380501234567', '+380501234567'],
    ['0501234567', '+380501234567'],
    ['050 123 45 67', '+380501234567'],
    ['80501234567', '+380501234567'],
    ['501234567', '+380501234567'],
    ['+48 601 234 567', '+48601234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', 'телефон', '48601234567', '+1234', '0000'])(
    'відхиляє «%s»',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});
