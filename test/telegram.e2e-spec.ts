import { DeliveryService } from '../src/telegram/delivery.service.js';
import { TelegramApiService } from '../src/telegram/telegram-api.service.js';

import {
  FakeTelegramApi,
  WEBHOOK_SECRET,
  type Call,
} from './helpers/fake-telegram.js';
import {
  PNG_PIXEL,
  createTestApp,
  type ApiClient,
  type TestApp,
} from './helpers/test-app.js';

const DRIVE_LINK = 'https://drive.google.com/file/d/abc123/view?usp=sharing';
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);

describe('Telegram-бот: каталог і картка проєкту (e2e)', () => {
  let testApp: TestApp;
  let owner: ApiClient;
  const fake = new FakeTelegramApi();

  beforeAll(async () => {
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
    await testApp.close();
  });

  async function createProject(extra: Record<string, unknown> = {}) {
    const response = await owner
      .post('/admin/projects')
      .send({
        title: 'Будинок «Лагуна»',
        buildingType: 'Приватний будинок',
        location: 'Київ',
        intro: 'Сучасний будинок.',
        isPublished: true,
        price: 4500,
        fileUrl: DRIVE_LINK,
        ...extra,
      })
      .expect(201);

    return response.body as { id: string; slug: string };
  }

  async function addPhoto(projectId: string) {
    await owner
      .post(`/admin/projects/${projectId}/images`)
      .attach('image', PNG_PIXEL, 'photo.png')
      .expect(201);
  }

  function sendUpdate(update: Record<string, unknown>) {
    return testApp.visitor
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', WEBHOOK_SECRET)
      .send(update)
      .expect(200);
  }

  const message = (text: string, chatType = 'private') => ({
    message: { message_id: 1, chat: { id: 111, type: chatType }, text },
  });

  const callback = (data: string) => ({
    callback_query: {
      id: 'cb1',
      data,
      message: { message_id: 7, chat: { id: 111, type: 'private' } },
    },
  });

  const menuTexts = (call: Call | undefined) =>
    ((call?.body.reply_markup?.keyboard ?? []) as { text: string }[][])
      .flat()
      .map((button) => button.text);

  const buttons = (call: Call | undefined) =>
    (
      (call?.body.reply_markup?.inline_keyboard ?? []) as {
        text: string;
        callback_data?: string;
      }[][]
    ).flat();

  it('відхиляє запити без правильного секрету', async () => {
    await testApp.visitor
      .post('/telegram/webhook')
      .send(message('/start'))
      .expect(403);
    await testApp.visitor
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'wrong')
      .send(message('/start'))
      .expect(403);

    expect(fake.calls).toHaveLength(0);
  });

  it('на /start вітає й вмикає постійне меню з підписами замість команд', async () => {
    await sendUpdate(message('/start'));

    const reply = fake.lastMessage();

    expect(reply?.body.text).toContain('Вітаю');
    expect(menuTexts(reply)).toEqual([
      '📐 Каталог проєктів',
      '🧾 Мої покупки',
      '❓ Як купити',
    ]);
    // Меню не ховається після натискання
    expect(reply?.body.reply_markup.is_persistent).toBe(true);
    expect(reply?.body.reply_markup.resize_keyboard).toBe(true);
  });

  it('кнопки меню працюють як текст: каталог, покупки, підказка', async () => {
    await createProject({ title: 'У продажу' });

    await sendUpdate(message('📐 Каталог проєктів'));

    expect(buttons(fake.lastMessage())[0].text).toContain('У продажу');

    await sendUpdate(message('🧾 Мої покупки'));

    expect(fake.lastMessage()?.body.text).toContain('немає покупок');

    await sendUpdate(message('❓ Як купити'));

    const help = fake.lastMessage();

    expect(help?.body.text).toContain('Як купити проєкт');
    expect(menuTexts(help)).toHaveLength(3);
  });

  it('команда /help показує підказку з меню', async () => {
    await sendUpdate(message('/help'));

    expect(fake.lastMessage()?.body.text).toContain('Як купити проєкт');
  });

  it('показує лише проєкти, які можна купити', async () => {
    const forSale = await createProject({ title: 'У продажу' });

    await createProject({ title: 'Без ціни', price: null });
    await createProject({ title: 'Чернетка', isPublished: false });
    await createProject({ title: 'Без файлу', fileUrl: '' });

    await sendUpdate(message('/projects'));

    const titles = buttons(fake.lastMessage()).map((button) => button.text);

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('У продажу');
    expect(buttons(fake.lastMessage())[0].callback_data).toBe(
      `view:${forSale.id}`,
    );
  });

  it('ділить каталог на сторінки по 10 і гортає їх на місці', async () => {
    for (let index = 1; index <= 12; index++) {
      await createProject({
        title: `Проєкт ${String(index).padStart(2, '0')}`,
      });
    }

    await sendUpdate(message('/projects'));

    const first = buttons(fake.lastMessage());

    expect(
      first.filter((button) => button.callback_data?.startsWith('view:')),
    ).toHaveLength(10);
    expect(first.map((button) => button.text)).toContain('1/2');
    expect(first.map((button) => button.text)).toContain('Далі ›');
    expect(first.map((button) => button.text)).not.toContain('‹ Назад');

    fake.reset();
    await sendUpdate(callback('list:2'));

    // Сторінка змінюється редагуванням того самого повідомлення
    const edit = fake.sent('editMessageText')[0];
    const second = buttons(edit);

    expect(edit.body.message_id).toBe(7);
    expect(
      second.filter((button) => button.callback_data?.startsWith('view:')),
    ).toHaveLength(2);
    expect(second.map((button) => button.text)).toContain('‹ Назад');
    expect(second.map((button) => button.text)).not.toContain('Далі ›');
    expect(fake.sent('answerCallbackQuery')).toHaveLength(1);
  });

  it('картка проєкту: спершу альбом, потім окремо опис із кнопкою «Купити»', async () => {
    const project = await createProject();

    await addPhoto(project.id);
    await addPhoto(project.id);

    await sendUpdate(callback(`view:${project.id}`));

    const order = fake.calls
      .map((call) => call.method)
      .filter((method) => method !== 'answerCallbackQuery');

    expect(order).toEqual(['sendMediaGroup', 'sendMessage']);

    const album = fake.sent('sendMediaGroup')[0];

    expect(album.files).toHaveLength(2);
    expect(album.body.media).toHaveLength(2);

    const card = fake.lastMessage();

    expect(card?.body.text).toContain('<b>Будинок «Лагуна»</b>');
    expect(card?.body.text).toContain('Ціна:');

    const actions = buttons(card);

    expect(actions[0].text).toContain('Купити за');
    expect(actions[0].callback_data).toBe(`buy:${project.id}`);
    expect(actions.map((button) => button.callback_data)).toContain('list:1');
  });

  it('з одним фото надсилає sendPhoto, бо альбом починається з двох', async () => {
    const project = await createProject();

    await addPhoto(project.id);
    await sendUpdate(callback(`view:${project.id}`));

    expect(fake.sent('sendMediaGroup')).toHaveLength(0);
    expect(fake.sent('sendPhoto')).toHaveLength(1);
  });

  it('посилання з сайту /start buy_<адреса> одразу відкриває потрібний проєкт', async () => {
    const wanted = await createProject({ title: 'Той самий' });

    await createProject({ title: 'Інший' });
    await sendUpdate(message(`/start buy_${wanted.slug}`));

    const card = fake.lastMessage();

    expect(card?.body.text).toContain('Той самий');
    expect(buttons(card)[0].callback_data).toBe(`buy:${wanted.id}`);
  });

  it('за посиланням на недоступний проєкт пропонує каталог', async () => {
    const draft = await createProject({ isPublished: false });

    for (const text of [
      `/start buy_${draft.slug}`,
      '/start buy_no-such-project',
    ]) {
      fake.reset();
      await sendUpdate(message(text));

      // Перше повідомлення вмикає меню, останнє пояснює, що проєкт недоступний
      const reply = fake.lastMessage();

      expect(reply?.body.text).toContain('недоступний');
      expect(buttons(reply).map((button) => button.callback_data)).toContain(
        'list:1',
      );
    }
  });

  it('при переході з сайту спершу вмикає меню, а картка проєкту лишається останньою', async () => {
    const project = await createProject();

    await sendUpdate(message(`/start buy_${project.slug}`));

    const messages = fake.sent('sendMessage');

    expect(menuTexts(messages[0])).toHaveLength(3);
    expect(messages[0].body.text).toContain('переглядали на сайті');
    expect(buttons(messages.at(-1))[0].callback_data).toBe(`buy:${project.id}`);
  });

  it('без токена провайдера кнопка «Купити» чесно повідомляє, що оплата налаштовується', async () => {
    const project = await createProject();

    await sendUpdate(callback(`buy:${project.id}`));

    expect(fake.lastMessage()?.body.text).toContain('ще налаштовується');
  });

  it('ігнорує повідомлення з груп, а на довільний текст нагадує про меню', async () => {
    await sendUpdate(message('/start', 'group'));

    expect(fake.calls).toHaveLength(0);

    await sendUpdate(message('привіт'));

    expect(menuTexts(fake.lastMessage())).toHaveLength(3);
  });

  it('не падає, коли Telegram повертає помилку', async () => {
    const original = fake.call.bind(fake);

    fake.call = () => Promise.reject(new Error('Telegram недоступний'));

    await sendUpdate(message('/start'));

    fake.call = original;
  });

  describe('видача проєкту покупцю', () => {
    it('надсилає PDF як документ з іменем файлу', async () => {
      const project = await createProject({ fileUrl: '' });

      await owner
        .post(`/admin/projects/${project.id}/file`)
        .attach('file', PDF, 'Проєкт будинку.pdf')
        .expect(201);

      const result = await testApp.app
        .get(DeliveryService)
        .deliverProject(111, project.id);

      expect(result).toBe('file');

      const document = fake.sent('sendDocument')[0];

      expect(document.files?.[0]).toMatchObject({
        field: 'document',
        filename: 'Проєкт будинку.pdf',
        mimeType: 'application/pdf',
        size: PDF.length,
      });
      expect(document.body.caption).toContain('Будинок «Лагуна»');
    });

    it('для великих файлів надсилає кнопку з посиланням на Google Диск', async () => {
      const project = await createProject();

      const result = await testApp.app
        .get(DeliveryService)
        .deliverProject(111, project.id);

      expect(result).toBe('link');

      const reply = fake.lastMessage();

      expect(reply?.body.reply_markup.inline_keyboard[0][0].url).toBe(
        DRIVE_LINK,
      );
    });

    it('кидає помилку, якщо віддавати нічого', async () => {
      const project = await createProject({ fileUrl: '' });

      await expect(
        testApp.app.get(DeliveryService).deliverProject(111, project.id),
      ).rejects.toThrow('nothing to deliver');
    });
  });

  describe('публічний API для сайту', () => {
    it('показує ціну й forSale лише для проєктів, які можна купити, без файлу й посилання', async () => {
      const selling = await createProject({ title: 'Продається' });
      const notSelling = await createProject({
        title: 'Не продається',
        price: null,
        fileUrl: '',
      });

      await addPhoto(selling.id);
      await addPhoto(notSelling.id);

      const list = await testApp.visitor.get('/public/projects').expect(200);
      const bySlug = Object.fromEntries(
        list.body.map((project: { slug: string }) => [project.slug, project]),
      );

      expect(bySlug[selling.slug]).toMatchObject({
        forSale: true,
        price: 4500,
      });
      expect(bySlug[notSelling.slug]).toMatchObject({
        forSale: false,
        price: null,
      });

      for (const project of list.body) {
        for (const secret of ['fileKey', 'fileName', 'fileSize', 'fileUrl']) {
          expect(Object.keys(project)).not.toContain(secret);
        }
      }
    });
  });
});
