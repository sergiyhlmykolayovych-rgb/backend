import {
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import crypto from 'node:crypto';

import { BotService } from './bot.service.js';
import { TelegramApiService } from './telegram-api.service.js';
import type { TelegramUpdate } from './telegram.types.js';

const POLL_TIMEOUT_SECONDS = 30;
const POLL_RETRY_MS = 5_000;
// pre_checkout_query приходить перед оплатою: на нього треба відповісти за кілька секунд
const ALLOWED_UPDATES = ['message', 'callback_query', 'pre_checkout_query'];

// Підключення бота до Telegram. На сервері (production) Telegram сам шле оновлення на
// адресу webhook. Локально за замовчуванням бот вимкнений, щоб розробка не відключила
// webhook справжнього сервера; щоб спробувати бота з компʼютера, задайте TELEGRAM_POLLING=true.
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  private polling = false;
  private pollController: AbortController | null = null;

  constructor(
    private readonly api: TelegramApiService,
    private readonly bot: BotService,
  ) {}

  private read(name: string) {
    return (process.env[name] ?? '').trim();
  }

  // Секрет, яким Telegram підписує запити до нас. Окремої змінної не потрібно:
  // він виводиться з ключа бота, якого ніхто сторонній не знає.
  getWebhookSecret() {
    return crypto
      .createHash('sha256')
      .update(`webhook:${this.api.getToken()}`)
      .digest('hex');
  }

  async onModuleInit() {
    if (!this.api.isConfigured() || process.env.NODE_ENV === 'test') {
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      await this.connectWebhook();

      return;
    }

    if (this.read('TELEGRAM_POLLING') === 'true') {
      void this.startPolling();
    }
  }

  onModuleDestroy() {
    this.polling = false;
    this.pollController?.abort();
  }

  private async connectWebhook() {
    const publicDomain = this.read('RAILWAY_PUBLIC_DOMAIN');
    const webhookUrl =
      this.read('TELEGRAM_WEBHOOK_URL') ||
      (publicDomain ? `https://${publicDomain}/api/v1/telegram/webhook` : '');

    if (!webhookUrl) {
      this.logger.warn(
        'Адресу сервера не визначено: задайте TELEGRAM_WEBHOOK_URL, інакше бот не отримуватиме повідомлення',
      );

      return;
    }

    try {
      await this.api.call('setWebhook', {
        url: webhookUrl,
        secret_token: this.getWebhookSecret(),
        allowed_updates: ALLOWED_UPDATES,
      });
      await this.setCommands();

      this.logger.log('Telegram-бота підключено');
    } catch (error) {
      this.logger.error(
        `Не вдалося підключити Telegram-бота: ${String(error)}`,
      );
    }
  }

  // Підказки в меню команд і опис бота, який видно до натискання «Старт».
  private async setCommands() {
    await this.api.call('setMyDescription', {
      description:
        'Готові архітектурні проєкти: перегляньте фото й опис, оплатіть у чаті та одразу отримайте файл проєкту.',
    });
    await this.api.call('setMyShortDescription', {
      short_description: 'Купити готовий архітектурний проєкт',
    });
    await this.api.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Почати' },
        { command: 'projects', description: 'Каталог проєктів' },
        { command: 'purchases', description: 'Мої покупки' },
        { command: 'help', description: 'Як купити' },
      ],
    });
  }

  // Довге опитування Telegram для локальної розробки без публічної адреси.
  private async startPolling() {
    try {
      await this.api.call('deleteWebhook');
      await this.setCommands();
    } catch (error) {
      this.logger.error(
        `Не вдалося запустити опитування Telegram: ${String(error)}`,
      );

      return;
    }

    this.logger.log(
      'Telegram-бот працює в режимі опитування (TELEGRAM_POLLING=true)',
    );
    this.polling = true;

    let offset = 0;

    while (this.polling) {
      try {
        const updates = await this.api.call<TelegramUpdate[]>(
          'getUpdates',
          {
            offset,
            timeout: POLL_TIMEOUT_SECONDS,
            allowed_updates: ALLOWED_UPDATES,
          },
          (POLL_TIMEOUT_SECONDS + 10) * 1000,
        );

        for (const update of updates) {
          offset = (update.update_id ?? offset) + 1;

          await this.bot.handleUpdate(update);
        }
      } catch (error) {
        if (!this.polling) {
          return;
        }

        this.logger.warn(`Помилка опитування Telegram: ${String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, POLL_RETRY_MS));
      }
    }
  }

  // Приймає оновлення від Telegram. Запит перевіряється секретом у заголовку.
  async handleUpdate(secret: string | undefined, update: TelegramUpdate) {
    const expected = Buffer.from(this.getWebhookSecret());
    const received = Buffer.from(secret ?? '');

    if (
      !this.api.isConfigured() ||
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    await this.bot.handleUpdate(update);

    return { ok: true };
  }
}
