import { Injectable, Logger } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SELLABLE_WHERE } from '../projects/sale.js';

import { DeliveryService } from './delivery.service.js';
import { TelegramApiService } from './telegram-api.service.js';
import { escapeHtml, formatPrice } from './telegram.format.js';
import type {
  InlineButton,
  TelegramMessage,
  TelegramPreCheckoutQuery,
} from './telegram.types.js';

type ChatId = number | string;

const PAYLOAD_PREFIX = 'project:';
// Telegram обмежує назву рахунку 32 символами, а опис — 255.
const INVOICE_TITLE_MAX = 32;
const INVOICE_DESCRIPTION_MAX = 255;
const PURCHASES_LIMIT = 10;

const projectIdFromPayload = (payload: string) =>
  payload.startsWith(PAYLOAD_PREFIX)
    ? payload.slice(PAYLOAD_PREFIX.length)
    : '';

// Оплата проєктів через вбудовані платежі Telegram (провайдер, наприклад Portmone):
// рахунок у чаті → перевірка перед оплатою → запис покупки → автоматична видача файлу.
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TelegramApiService,
    private readonly delivery: DeliveryService,
  ) {}

  private read(name: string) {
    return (process.env[name] ?? '').trim();
  }

  // Токен провайдера з @BotFather → Payments. Тестовий токен дозволяє платити тестовими картками.
  private getProviderToken() {
    return this.read('TELEGRAM_PAYMENT_PROVIDER_TOKEN');
  }

  private getCurrency() {
    return this.read('TELEGRAM_PAYMENT_CURRENCY') || 'UAH';
  }

  isConfigured() {
    return Boolean(this.getProviderToken());
  }

  // Ціна в мінімальних одиницях валюти (копійках): Telegram приймає лише цілі числа.
  private toMinorUnits(price: unknown) {
    return Math.round(Number(price) * 100);
  }

  // Кнопка «Купити»: виставляє рахунок на проєкт.
  async startCheckout(chatId: ChatId, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { ...SELLABLE_WHERE, id: projectId },
      select: { id: true, title: true, intro: true, price: true },
    });

    if (!project) {
      return this.send(chatId, 'Цей проєкт зараз недоступний.', [
        [{ text: 'До списку проєктів', callback_data: 'list:1' }],
      ]);
    }

    if (!this.isConfigured()) {
      return this.send(
        chatId,
        `Оплата проєкту «${escapeHtml(project.title)}» (${formatPrice(project.price)}) ще налаштовується. Спробуйте трохи пізніше.`,
      );
    }

    await this.api.call('sendInvoice', {
      chat_id: chatId,
      title: project.title.slice(0, INVOICE_TITLE_MAX),
      description: (
        project.intro || 'Готовий архітектурний проєкт у форматі PDF'
      ).slice(0, INVOICE_DESCRIPTION_MAX),
      payload: `${PAYLOAD_PREFIX}${project.id}`,
      provider_token: this.getProviderToken(),
      currency: this.getCurrency(),
      prices: [{ label: 'Проєкт', amount: this.toMinorUnits(project.price) }],
    });
  }

  // Telegram питає, чи можна провести оплату, і чекає відповідь кілька секунд.
  // Перевіряємо, що проєкт досі продається за ту саму ціну.
  async handlePreCheckout(query: TelegramPreCheckoutQuery) {
    let error: string | null = null;

    try {
      const project = await this.prisma.project.findFirst({
        where: {
          ...SELLABLE_WHERE,
          id: projectIdFromPayload(query.invoice_payload),
        },
        select: { price: true },
      });

      if (!project) {
        error = 'Цей проєкт більше недоступний.';
      } else if (
        query.currency !== this.getCurrency() ||
        query.total_amount !== this.toMinorUnits(project.price)
      ) {
        error = 'Ціна проєкту змінилась. Відкрийте проєкт і спробуйте ще раз.';
      }
    } catch (caught) {
      this.logger.error(`Помилка перевірки перед оплатою: ${String(caught)}`);
      error = 'Тимчасова помилка. Спробуйте ще раз за хвилину.';
    }

    await this.api.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok: error === null,
      ...(error ? { error_message: error } : {}),
    });
  }

  // Оплата пройшла: записуємо покупку й одразу віддаємо файл. Унікальний номер платежу
  // захищає від повторної видачі, якщо Telegram надішле те саме оновлення двічі.
  async handleSuccessfulPayment(message: TelegramMessage) {
    const payment = message.successful_payment;

    if (!payment) {
      return;
    }

    const chatId = message.chat.id;
    const projectId = projectIdFromPayload(payment.invoice_payload);
    const project = projectId
      ? await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, title: true },
        })
      : null;

    let purchase;

    try {
      purchase = await this.prisma.purchase.create({
        data: {
          projectId: project?.id ?? null,
          projectTitle: project?.title ?? 'Невідомий проєкт',
          chatId: String(chatId),
          amount: payment.total_amount / 100,
          currency: payment.currency,
          chargeId: payment.telegram_payment_charge_id,
          providerChargeId: payment.provider_payment_charge_id || null,
        },
      });
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )) {
        throw error;
      }

      purchase = await this.prisma.purchase.findUniqueOrThrow({
        where: { chargeId: payment.telegram_payment_charge_id },
      });

      // Те саме оновлення прийшло повторно, а файл уже відправлено.
      if (purchase.deliveredAt) {
        return;
      }
    }

    await this.deliverPurchase(chatId, purchase);
  }

  private async deliverPurchase(
    chatId: ChatId,
    purchase: { id: string; projectId: string | null },
  ) {
    try {
      if (!purchase.projectId) {
        throw new Error('Покупка без проєкту');
      }

      await this.delivery.deliverProject(chatId, purchase.projectId);
      await this.prisma.purchase.update({
        where: { id: purchase.id },
        data: { deliveredAt: new Date(), deliveryError: null },
      });
    } catch (error) {
      // Гроші вже сплачено, тому помилку не губимо: зберігаємо її й даємо людині вихід.
      this.logger.error(
        `Не вдалося віддати проєкт за покупкою ${purchase.id}: ${String(error)}`,
      );

      await this.prisma.purchase
        .update({
          where: { id: purchase.id },
          data: { deliveryError: String(error).slice(0, 250) },
        })
        .catch(() => undefined);

      await this.send(
        chatId,
        'Дякуємо за оплату! Не вдалося надіслати файл автоматично. Натисніть /purchases, щоб отримати його ще раз, або напишіть нам.',
        [[{ text: 'Мої покупки', callback_data: 'purchases' }]],
      );
    }
  }

  // «Мої покупки»: список оплачених проєктів із кнопкою повторного отримання файлу.
  async sendPurchases(chatId: ChatId) {
    const purchases = await this.prisma.purchase.findMany({
      where: { chatId: String(chatId) },
      orderBy: { paidAt: 'desc' },
      take: PURCHASES_LIMIT,
      select: { id: true, projectTitle: true, paidAt: true },
    });

    if (purchases.length === 0) {
      return this.send(chatId, 'У вас ще немає покупок.', [
        [{ text: 'Переглянути проєкти', callback_data: 'list:1' }],
      ]);
    }

    await this.send(
      chatId,
      '<b>Ваші покупки</b>\nНатисніть на проєкт, щоб отримати файл ще раз.',
      purchases.map((purchase) => [
        {
          text: `${purchase.projectTitle.slice(0, 36)} · ${purchase.paidAt.toLocaleDateString('uk-UA')}`,
          callback_data: `get:${purchase.id}`,
        },
      ]),
    );
  }

  // Повторне отримання файлу. Перевіряємо, що покупка належить саме цьому чату.
  async resend(chatId: ChatId, purchaseId: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, chatId: String(chatId) },
      select: { id: true, projectId: true },
    });

    if (!purchase) {
      return this.send(chatId, 'Покупку не знайдено.');
    }

    await this.deliverPurchase(chatId, purchase);
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
}
