import { TelegramApiService } from '../src/telegram/telegram-api.service.js';

import {
  FakeTelegramApi,
  WEBHOOK_SECRET,
  type Call,
} from './helpers/fake-telegram.js';
import {
  createTestApp,
  type ApiClient,
  type TestApp,
} from './helpers/test-app.js';

const DRIVE_LINK = 'https://drive.google.com/file/d/abc123/view?usp=sharing';
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);
const CHAT = 111;

describe('Telegram-бот: оплата й видача проєкту (e2e)', () => {
  let testApp: TestApp;
  let owner: ApiClient;
  const fake = new FakeTelegramApi();

  beforeAll(async () => {
    process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN = 'TEST:provider-token';

    testApp = await createTestApp((builder) =>
      builder.overrideProvider(TelegramApiService).useValue(fake),
    );
  });

  beforeEach(async () => {
    await testApp.resetData();
    fake.reset();
    owner = await testApp.loginAsOwner();
  });

  afterAll(async () => {
    delete process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN;

    await testApp.close();
  });

  async function createProject(extra: Record<string, unknown> = {}) {
    const response = await owner
      .post('/admin/projects')
      .send({
        title: 'Будинок «Лагуна»',
        buildingType: 'Приватний будинок',
        isPublished: true,
        price: 4500,
        fileUrl: DRIVE_LINK,
        ...extra,
      })
      .expect(201);

    return response.body as { id: string };
  }

  function sendUpdate(update: Record<string, unknown>) {
    return testApp.visitor
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', WEBHOOK_SECRET)
      .send(update)
      .expect(200);
  }

  const paymentUpdate = (
    projectId: string,
    chargeId = 'charge-1',
    chatId = CHAT,
  ) => ({
    message: {
      message_id: 5,
      chat: { id: chatId, type: 'private' },
      successful_payment: {
        currency: 'UAH',
        total_amount: 450000,
        invoice_payload: `project:${projectId}`,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: 'provider-1',
      },
    },
  });

  const preCheckout = (
    projectId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    pre_checkout_query: {
      id: 'q1',
      currency: 'UAH',
      total_amount: 450000,
      invoice_payload: `project:${projectId}`,
      ...overrides,
    },
  });

  const callback = (data: string, chatId = CHAT) => ({
    callback_query: {
      id: 'cb1',
      data,
      message: { message_id: 7, chat: { id: chatId, type: 'private' } },
    },
  });

  const buttons = (call: Call | undefined) =>
    (
      (call?.body.reply_markup?.inline_keyboard ?? []) as {
        text: string;
        callback_data?: string;
        url?: string;
      }[][]
    ).flat();

  describe('рахунок', () => {
    it('кнопка «Купити» виставляє рахунок у гривнях із ціною в копійках', async () => {
      const project = await createProject({
        title: 'Дуже довга назва проєкту, яка не вміщається в рахунок',
      });

      await sendUpdate(callback(`buy:${project.id}`));

      const invoice = fake.sent('sendInvoice')[0];

      expect(invoice.body).toMatchObject({
        chat_id: CHAT,
        currency: 'UAH',
        provider_token: 'TEST:provider-token',
        payload: `project:${project.id}`,
        prices: [{ label: 'Проєкт', amount: 450000 }],
      });
      // Telegram приймає назву рахунку не довшу за 32 символи
      expect(invoice.body.title.length).toBeLessThanOrEqual(32);
    });

    it('без токена провайдера оплата ще налаштовується', async () => {
      delete process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN;

      try {
        const project = await createProject();

        await sendUpdate(callback(`buy:${project.id}`));

        expect(fake.sent('sendInvoice')).toHaveLength(0);
        expect(fake.lastMessage()?.body.text).toContain('ще налаштовується');
      } finally {
        process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN = 'TEST:provider-token';
      }
    });

    it('не виставляє рахунок на проєкт, який не продається', async () => {
      const draft = await createProject({ isPublished: false });

      await sendUpdate(callback(`buy:${draft.id}`));

      expect(fake.sent('sendInvoice')).toHaveLength(0);
      expect(fake.lastMessage()?.body.text).toContain('недоступний');
    });
  });

  describe('перевірка перед оплатою', () => {
    it('дозволяє оплату за правильною ціною', async () => {
      const project = await createProject();

      await sendUpdate(preCheckout(project.id));

      expect(fake.sent('answerPreCheckoutQuery')[0].body).toMatchObject({
        pre_checkout_query_id: 'q1',
        ok: true,
      });
    });

    it('відхиляє оплату, якщо ціна не збігається', async () => {
      const project = await createProject();

      await sendUpdate(preCheckout(project.id, { total_amount: 100 }));

      const answer = fake.sent('answerPreCheckoutQuery')[0].body;

      expect(answer.ok).toBe(false);
      expect(answer.error_message).toContain('Ціна');
    });

    it('відхиляє оплату проєкту, який зняли з продажу', async () => {
      const project = await createProject({ isPublished: false });

      await sendUpdate(preCheckout(project.id));

      expect(fake.sent('answerPreCheckoutQuery')[0].body.ok).toBe(false);
    });
  });

  describe('успішна оплата', () => {
    it('записує покупку й надсилає PDF', async () => {
      const project = await createProject({ fileUrl: '' });

      await owner
        .post(`/admin/projects/${project.id}/file`)
        .attach('file', PDF, 'Проєкт.pdf')
        .expect(201);

      await sendUpdate(paymentUpdate(project.id));

      const purchases = await testApp.prisma.purchase.findMany();

      expect(purchases).toHaveLength(1);
      expect(purchases[0]).toMatchObject({
        projectId: project.id,
        projectTitle: 'Будинок «Лагуна»',
        chatId: String(CHAT),
        currency: 'UAH',
        chargeId: 'charge-1',
      });
      expect(Number(purchases[0].amount)).toBe(4500);
      expect(purchases[0].deliveredAt).not.toBeNull();

      expect(fake.sent('sendDocument')[0].files?.[0]).toMatchObject({
        filename: 'Проєкт.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('для проєкту з посиланням надсилає кнопку на Google Диск', async () => {
      const project = await createProject();

      await sendUpdate(paymentUpdate(project.id));

      const link = buttons(fake.lastMessage()).find((button) => button.url);

      expect(link?.url).toBe(DRIVE_LINK);
      expect(
        (await testApp.prisma.purchase.findFirstOrThrow()).deliveredAt,
      ).not.toBeNull();
    });

    it('не віддає проєкт двічі, якщо Telegram повторив оновлення', async () => {
      const project = await createProject();

      await sendUpdate(paymentUpdate(project.id));
      await sendUpdate(paymentUpdate(project.id));

      expect(await testApp.prisma.purchase.count()).toBe(1);
      expect(
        fake
          .sent('sendMessage')
          .filter((call) => buttons(call).some((button) => button.url)),
      ).toHaveLength(1);
    });

    it('зберігає покупку й дає вихід, якщо файл віддати не вдалося', async () => {
      const project = await createProject();

      // Після оплати файл зник: прибрали посилання.
      await owner
        .patch(`/admin/projects/${project.id}`)
        .send({ fileUrl: '' })
        .expect(200);

      await sendUpdate(paymentUpdate(project.id));

      const purchase = await testApp.prisma.purchase.findFirstOrThrow();

      expect(purchase.deliveredAt).toBeNull();
      expect(purchase.deliveryError).toContain('nothing to deliver');

      const reply = fake.lastMessage();

      expect(reply?.body.text).toContain('/purchases');
      expect(buttons(reply).map((button) => button.callback_data)).toContain(
        'purchases',
      );
    });
  });

  describe('мої покупки', () => {
    it('показує, що покупок ще немає', async () => {
      await sendUpdate({
        message: {
          message_id: 1,
          chat: { id: CHAT, type: 'private' },
          text: '/purchases',
        },
      });

      expect(fake.lastMessage()?.body.text).toContain('немає покупок');
    });

    it('дозволяє отримати файл ще раз, але лише власнику покупки', async () => {
      const project = await createProject();

      await owner
        .patch(`/admin/projects/${project.id}`)
        .send({ fileUrl: '' })
        .expect(200);
      await sendUpdate(paymentUpdate(project.id));

      const purchase = await testApp.prisma.purchase.findFirstOrThrow();

      await sendUpdate(callback('purchases'));

      expect(
        buttons(fake.lastMessage()).map((button) => button.callback_data),
      ).toEqual([`get:${purchase.id}`]);

      // Власник виправив проблему: повернув посилання
      await owner
        .patch(`/admin/projects/${project.id}`)
        .send({ fileUrl: DRIVE_LINK })
        .expect(200);

      fake.reset();
      await sendUpdate(callback(`get:${purchase.id}`, 222));

      // Чужий чат файл не отримує
      expect(fake.lastMessage()?.body.text).toContain('не знайдено');
      expect(
        (await testApp.prisma.purchase.findFirstOrThrow()).deliveredAt,
      ).toBeNull();

      fake.reset();
      await sendUpdate(callback(`get:${purchase.id}`));

      expect(
        buttons(fake.lastMessage()).find((button) => button.url)?.url,
      ).toBe(DRIVE_LINK);
      expect(
        (await testApp.prisma.purchase.findFirstOrThrow()).deliveredAt,
      ).not.toBeNull();
    });
  });
});
