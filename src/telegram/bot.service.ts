import { Injectable, Logger } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SELLABLE_WHERE } from '../projects/sale.js';
import { FileStorageService } from '../storage/file-storage.service.js';

import { PaymentService } from './payment.service.js';
import {
  TelegramApiService,
  type TelegramFile,
} from './telegram-api.service.js';
import {
  buildListText,
  buildProjectCard,
  formatPrice,
} from './telegram.format.js';
import { streamToBuffer } from './telegram.util.js';
import type {
  InlineButton,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types.js';

// Скільки проєктів у списку на одній сторінці; решта — стрілками «Назад» / «Далі».
const PAGE_SIZE = 10;
// Альбом у Telegram: від 2 до 10 фото.
const MAX_ALBUM_PHOTOS = 10;
const TITLE_BUTTON_MAX = 38;

type ChatId = number | string;

// Постійне меню внизу чату: кнопки з підписами замість команд. Натискання надсилає боту
// цей самий текст, а бот розпізнає його нижче в onMessage.
export const MENU_PROJECTS = '📐 Каталог проєктів';
export const MENU_PURCHASES = '🧾 Мої покупки';
export const MENU_HELP = '❓ Як купити';

const MENU_KEYBOARD = {
  keyboard: [
    [{ text: MENU_PROJECTS }],
    [{ text: MENU_PURCHASES }, { text: MENU_HELP }],
  ],
  resize_keyboard: true,
  // Клавіатура лишається видимою, а не ховається після натискання
  is_persistent: true,
  input_field_placeholder: 'Оберіть розділ у меню',
};

const listData = (page: number) => `list:${page}`;
const viewData = (projectId: string) => `view:${projectId}`;
const buyData = (projectId: string) => `buy:${projectId}`;

const projectSelect = {
  id: true,
  slug: true,
  title: true,
  buildingType: true,
  location: true,
  year: true,
  area: true,
  scope: true,
  intro: true,
  concept: true,
  price: true,
  fileKey: true,
  fileName: true,
  fileUrl: true,
  images: {
    select: { id: true, fileKey: true, mimeType: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ALBUM_PHOTOS,
  },
} satisfies Prisma.ProjectSelect;

// Логіка бота: каталог готових проєктів, картка проєкту (альбом, а під ним опис із кнопкою
// «Купити»), перехід із сайту за посиланням `?start=buy_<адреса проєкту>`.
// Оплату й видачу файлу ведуть PaymentService і DeliveryService.
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly api: TelegramApiService,
    private readonly payment: PaymentService,
  ) {}

  // Ніколи не кидає помилку: збій однієї відповіді не повинен ламати прийом решти оновлень.
  async handleUpdate(update: TelegramUpdate) {
    try {
      if (update.pre_checkout_query) {
        await this.payment.handlePreCheckout(update.pre_checkout_query);
      } else if (update.callback_query) {
        await this.onCallback(update.callback_query);
      } else if (update.message) {
        await this.onMessage(update.message);
      }
    } catch (error) {
      this.logger.error(
        `Не вдалося обробити оновлення Telegram: ${String(error)}`,
      );
    }
  }

  private async onMessage(message: TelegramMessage) {
    // Повідомлення про успішну оплату не має тексту, тому обробляємо його першим.
    if (message.successful_payment) {
      return this.payment.handleSuccessfulPayment(message);
    }

    // Бот працює лише в особистих чатах.
    if (message.chat.type && message.chat.type !== 'private') {
      return;
    }

    const chatId = message.chat.id;
    const text = (message.text ?? '').trim();
    const [command, ...rest] = text.split(/\s+/);
    // У групах і з підказки команди приходять як /start@імʼя_бота
    const name = command?.split('@')[0]?.toLowerCase();
    const payload = rest.join(' ').trim();

    if (name === '/start') {
      return this.onStart(chatId, payload);
    }

    if (name === '/projects') {
      return this.showList(chatId, 1);
    }

    if (name === '/purchases') {
      return this.payment.sendPurchases(chatId);
    }

    if (name === '/help') {
      return this.sendHelp(chatId);
    }

    // Кнопки постійного меню приходять як звичайний текст
    if (text === MENU_PROJECTS) {
      return this.showList(chatId, 1);
    }

    if (text === MENU_PURCHASES) {
      return this.payment.sendPurchases(chatId);
    }

    if (text === MENU_HELP) {
      return this.sendHelp(chatId);
    }

    await this.sendWithMenu(
      chatId,
      'Оберіть розділ у меню внизу: каталог проєктів, ваші покупки або підказка, як купити.',
    );
  }

  private async onStart(chatId: ChatId, payload: string) {
    // Посилання з сайту й Instagram: t.me/бот?start=buy_<адреса проєкту>
    if (payload.startsWith('buy_')) {
      // Спершу підключаємо меню внизу, а потім показуємо проєкт, щоб картка лишилась останньою
      await this.sendWithMenu(
        chatId,
        '<b>Вітаю!</b> Ось проєкт, який ви переглядали на сайті. Решта розділів бота в меню внизу.',
      );

      return this.showProject(chatId, { slug: payload.slice('buy_'.length) });
    }

    await this.sendWithMenu(
      chatId,
      [
        '<b>Вітаю!</b>',
        'Тут можна купити готові архітектурні проєкти: перегляньте фото й опис, а після оплати проєкт прийде прямо в цей чат.',
        'Розділи бота завжди під рукою в меню внизу.',
      ].join('\n\n'),
    );
  }

  private async sendHelp(chatId: ChatId) {
    await this.sendWithMenu(
      chatId,
      [
        '<b>Як купити проєкт</b>',
        '1. Відкрийте «Каталог проєктів» і оберіть потрібний.\n2. Перегляньте фото й опис.\n3. Натисніть «Купити» й оплатіть карткою в цьому чаті.\n4. Файл проєкту прийде сюди одразу після оплати.',
        'Загубили файл? Відкрийте «Мої покупки» й отримайте його ще раз.',
      ].join('\n\n'),
    );
  }

  private async onCallback(query: TelegramCallbackQuery) {
    const chatId = query.message?.chat.id;

    // Прибираємо «годинник» на кнопці, навіть якщо далі щось піде не так.
    await this.api
      .call('answerCallbackQuery', { callback_query_id: query.id })
      .catch(() => undefined);

    if (chatId === undefined) {
      return;
    }

    const [action, value] = (query.data ?? '').split(':');

    if (action === 'list') {
      return this.showList(
        chatId,
        Number(value) || 1,
        query.message?.message_id,
      );
    }

    if (action === 'view' && value) {
      return this.showProject(chatId, { id: value });
    }

    if (action === 'purchases') {
      return this.payment.sendPurchases(chatId);
    }

    if (action === 'get' && value) {
      return this.payment.resend(chatId, value);
    }

    if (action === 'buy' && value) {
      return this.payment.startCheckout(chatId, value);
    }
  }

  // Список проєктів у продажу, по 10 на сторінці. З кнопок пагінації повідомлення
  // редагується на місці, а не приходить заново.
  async showList(
    chatId: ChatId,
    requestedPage: number,
    editMessageId?: number,
  ) {
    const total = await this.prisma.project.count({ where: SELLABLE_WHERE });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, requestedPage), totalPages);

    if (total === 0) {
      return this.send(
        chatId,
        'Поки що немає проєктів у продажу. Зазирніть трохи пізніше.',
      );
    }

    const projects = await this.prisma.project.findMany({
      where: SELLABLE_WHERE,
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, price: true },
    });

    const rows: InlineButton[][] = projects.map((project) => [
      {
        text: `${this.shortTitle(project.title)} · ${formatPrice(project.price)}`,
        callback_data: viewData(project.id),
      },
    ]);

    if (totalPages > 1) {
      const nav: InlineButton[] = [];

      if (page > 1) {
        nav.push({ text: '‹ Назад', callback_data: listData(page - 1) });
      }

      nav.push({ text: `${page}/${totalPages}`, callback_data: 'noop' });

      if (page < totalPages) {
        nav.push({ text: 'Далі ›', callback_data: listData(page + 1) });
      }

      rows.push(nav);
    }

    const text = buildListText(page, totalPages, total);

    if (editMessageId !== undefined) {
      try {
        await this.api.call('editMessageText', {
          chat_id: chatId,
          message_id: editMessageId,
          text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });

        return;
      } catch {
        // Повідомлення могло не змінитись або застаріти: тоді надсилаємо нове.
      }
    }

    await this.send(chatId, text, rows);
  }

  // Картка проєкту: спершу альбом із фото, а окремим повідомленням під ним
  // назва, опис, ціна та кнопка «Купити» (до альбому кнопки Telegram прикріпити не дозволяє).
  async showProject(chatId: ChatId, by: { id: string } | { slug: string }) {
    const project = await this.prisma.project.findFirst({
      where: { ...SELLABLE_WHERE, ...by },
      select: projectSelect,
    });

    if (!project) {
      return this.send(
        chatId,
        'Цей проєкт зараз недоступний. Перегляньте інші.',
        [[{ text: 'До списку проєктів', callback_data: listData(1) }]],
      );
    }

    await this.sendAlbum(chatId, project.images).catch((error) => {
      this.logger.warn(
        `Не вдалося надіслати фото проєкту ${project.slug}: ${String(error)}`,
      );
    });

    await this.send(chatId, buildProjectCard(project), [
      [
        {
          text: `Купити за ${formatPrice(project.price)}`,
          callback_data: buyData(project.id),
        },
      ],
      [{ text: '← До списку', callback_data: listData(1) }],
    ]);
  }

  private async sendAlbum(
    chatId: ChatId,
    images: { id: string; fileKey: string; mimeType: string }[],
  ) {
    const files: TelegramFile[] = [];

    for (const [index, image] of images.entries()) {
      const stream = await this.storage.get(image.fileKey);

      if (!stream) {
        continue;
      }

      files.push({
        field: `photo${index}`,
        filename: `photo${index}.jpg`,
        mimeType: image.mimeType,
        content: await streamToBuffer(stream),
      });
    }

    if (files.length === 0) {
      return;
    }

    // Альбом приймає від 2 фото, а з одним потрібен звичайний sendPhoto.
    if (files.length === 1) {
      await this.api.upload('sendPhoto', { chat_id: chatId }, [
        { ...files[0], field: 'photo' },
      ]);

      return;
    }

    await this.api.upload(
      'sendMediaGroup',
      {
        chat_id: chatId,
        media: files.map((file) => ({
          type: 'photo',
          media: `attach://${file.field}`,
        })),
      },
      files,
    );
  }

  private async send(
    chatId: ChatId,
    html: string,
    keyboard?: InlineButton[][],
  ) {
    await this.api.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  // Повідомлення, що вмикає (або оновлює) постійне меню внизу чату.
  private async sendWithMenu(chatId: ChatId, html: string) {
    await this.api.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      reply_markup: MENU_KEYBOARD,
    });
  }

  private shortTitle(title: string) {
    return title.length > TITLE_BUTTON_MAX
      ? `${title.slice(0, TITLE_BUTTON_MAX - 1)}…`
      : title;
  }
}
