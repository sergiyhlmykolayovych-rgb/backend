// Чисті функції для текстів бота: їх легко перевіряти окремо від Telegram.

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 4500 → «4 500 ₴»
export function formatPrice(price: unknown) {
  const amount = Number(price);

  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(amount)} ₴`;
}

function truncate(text: string, max: number) {
  const clean = text.trim();

  if (clean.length <= max) {
    return clean;
  }

  return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export interface CardProject {
  title: string;
  buildingType: string;
  location: string | null;
  year: number | null;
  area: string | null;
  scope: string | null;
  intro: string;
  concept: string;
  price: unknown;
}

// Підпис під альбомом: назва, коротко про проєкт, характеристики й ціна.
// Ліміт Telegram на текст повідомлення — 4096 символів, тож опис стискаємо.
export function buildProjectCard(project: CardProject) {
  const facts = [
    ['Тип', project.buildingType],
    ['Місце', project.location],
    ['Рік', project.year ? String(project.year) : null],
    ['Площа', project.area],
    ['Обсяг робіт', project.scope],
  ]
    .filter((fact): fact is [string, string] => Boolean(fact[1]))
    .map(([label, value]) => `${label}: ${escapeHtml(value)}`);

  const description = truncate(
    [project.intro, project.concept].filter(Boolean).join('\n\n'),
    900,
  );

  return [
    `<b>${escapeHtml(project.title)}</b>`,
    description ? escapeHtml(description) : '',
    facts.join('\n'),
    `<b>Ціна: ${formatPrice(project.price)}</b>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildListText(page: number, totalPages: number, total: number) {
  return [
    '<b>Готові архітектурні проєкти</b>',
    `Оберіть проєкт, щоб побачити фото й опис. Усього: ${total}.`,
    totalPages > 1 ? `Сторінка ${page} з ${totalPages}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
