import {
  buildProjectCard,
  escapeHtml,
  formatPrice,
} from './telegram.format.js';

const project = {
  title: 'Будинок <Лагуна> & сад',
  buildingType: 'Приватний будинок',
  location: 'Київська область',
  year: 2024,
  area: null,
  scope: null,
  intro: 'Сучасний будинок.',
  concept: 'Два зсунуті обʼєми.',
  price: '4500',
};

describe('telegram.format', () => {
  it('екранує HTML, щоб назва не ламала повідомлення', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('форматує ціну в гривнях', () => {
    expect(formatPrice('4500').replace(/\s/g, ' ')).toBe('4 500 ₴');
    expect(formatPrice(1250.5).replace(/\s/g, ' ')).toBe('1 250,5 ₴');
  });

  it('збирає картку з назвою, описом, характеристиками й ціною', () => {
    const card = buildProjectCard(project);

    expect(card).toContain('<b>Будинок &lt;Лагуна&gt; &amp; сад</b>');
    expect(card).toContain('Сучасний будинок.');
    expect(card).toContain('Тип: Приватний будинок');
    expect(card).toContain('Місце: Київська область');
    expect(card).toContain('Рік: 2024');
    expect(card).not.toContain('Площа');
    expect(card).toContain('Ціна:');
  });

  it('стискає дуже довгий опис, щоб вкластися в ліміт Telegram', () => {
    const card = buildProjectCard({
      ...project,
      concept: 'слово '.repeat(2000),
    });

    expect(card.length).toBeLessThan(1400);
    expect(card).toContain('…');
  });
});
