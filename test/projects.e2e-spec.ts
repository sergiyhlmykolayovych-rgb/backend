import {
  PNG_PIXEL,
  createTestApp,
  type ApiClient,
  type TestApp,
} from './helpers/test-app.js';

describe('Проєкти портфоліо (e2e)', () => {
  let testApp: TestApp;
  let owner: ApiClient;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await testApp.resetData();
    owner = await testApp.loginAsOwner();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function createProject(
    title: string,
    extra: Record<string, unknown> = {},
  ) {
    const response = await owner
      .post('/admin/projects')
      .send({ title, buildingType: 'Приватний будинок', ...extra })
      .expect(201);

    return response.body as { id: string; slug: string };
  }

  function addImage(projectId: string) {
    return owner
      .post(`/admin/projects/${projectId}/images`)
      .attach('image', PNG_PIXEL, 'photo.png');
  }

  it('будує адресу з назви й робить її унікальною', async () => {
    const first = await createProject('Будинок «Тиха балка»');
    const second = await createProject('Будинок «Тиха балка»');

    expect(first.slug).toBe('budynok-tykha-balka');
    expect(second.slug).toBe('budynok-tykha-balka-2');

    await owner
      .post('/admin/projects')
      .send({ title: 'Інший', buildingType: 'Будинок', slug: first.slug })
      .expect(409);
  });

  it('не показує на сайті чернетки та проєкти без фото', async () => {
    const draft = await createProject('Чернетка');
    await addImage(draft.id).expect(201);

    const withoutPhoto = await createProject('Без фото', { isPublished: true });

    expect(withoutPhoto.id).toBeDefined();

    const list = await testApp.visitor.get('/public/projects').expect(200);

    expect(list.body).toEqual([]);
  });

  it('віддає на сайт опублікований проєкт із фото та файлом фото', async () => {
    const project = await createProject('Магазин «Ріг»', {
      category: 'COMMERCIAL',
      buildingType: 'Комерційна будівля',
      location: 'Дніпро',
      year: 2024,
      isPublished: true,
    });

    const image = (await addImage(project.id).expect(201)).body as {
      id: string;
    };

    const list = await testApp.visitor.get('/public/projects').expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      slug: project.slug,
      category: 'commercial',
      location: 'Дніпро',
      year: 2024,
      images: [{ id: image.id }],
    });
    // Службові поля на сайт не потрапляють.
    expect(list.body[0].isPublished).toBeUndefined();

    await testApp.visitor.get(`/public/projects/${project.slug}`).expect(200);

    const file = await testApp.visitor
      .get(`/public/projects/images/${image.id}`)
      .expect(200);

    expect(file.headers['content-type']).toContain('image/png');
  });

  it('відхиляє файл, що не є зображенням', async () => {
    const project = await createProject('Тест');

    await owner
      .post(`/admin/projects/${project.id}/images`)
      .attach('image', Buffer.from('<svg></svg>'), 'bad.svg')
      .expect(400);

    await owner
      .post(`/admin/projects/${project.id}/images`)
      .attach('image', Buffer.from('not a png'), 'fake.png')
      .expect(400);
  });

  it('змінює порядок фото й проєктів', async () => {
    const a = await createProject('Перший', { isPublished: true });
    const b = await createProject('Другий', { isPublished: true });
    const first = (await addImage(a.id).expect(201)).body as { id: string };
    const second = (await addImage(a.id).expect(201)).body as { id: string };
    await addImage(b.id).expect(201);

    await owner
      .put(`/admin/projects/${a.id}/images/order`)
      .send({ ids: [second.id, first.id] })
      .expect(200);

    await owner
      .put('/admin/projects/order')
      .send({ ids: [a.id, b.id] })
      .expect(200);

    const list = await testApp.visitor.get('/public/projects').expect(200);

    expect(list.body.map((project: { slug: string }) => project.slug)).toEqual([
      a.slug,
      b.slug,
    ]);
    expect(list.body[0].images[0].id).toBe(second.id);
  });

  it('видаляє проєкт разом із фото', async () => {
    const project = await createProject('Видалити', { isPublished: true });
    const image = (await addImage(project.id).expect(201)).body as {
      id: string;
    };

    await owner.delete(`/admin/projects/${project.id}`).expect(200);

    await owner.get(`/admin/projects/${project.id}`).expect(404);
    await testApp.visitor
      .get(`/public/projects/images/${image.id}`)
      .expect(404);
  });
});
