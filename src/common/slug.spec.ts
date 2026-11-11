import { toSlug } from './slug.js';

describe('toSlug', () => {
  it('перетворює українську назву на латинську адресу', () => {
    expect(toSlug('Будинок «Тиха балка»')).toBe('budynok-tykha-balka');
  });

  it('ігнорує апострофи й зайві символи', () => {
    expect(toSlug("Дім'я  —  №1!")).toBe('dimia-1');
  });

  it('повертає запасну адресу, коли літер немає', () => {
    expect(toSlug('«»')).toBe('project');
  });
});
