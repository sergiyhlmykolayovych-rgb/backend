import {
  createTestApp,
  type ApiClient,
  type TestApp,
} from './helpers/test-app.js';

// Те саме, що надсилає форма на сайті.
const validRequest = {
  buildingType: 'house',
  area: '',
  location: 'Київ',
  stage: '',
  scope: '',
  budget: '',
  style: '',
  floors: '',
  siteInfo: '',
  requirements: '',
  name: 'Олена',
  phone: '050 123 45 67',
  email: '',
  message: '',
  consent: true,
};

describe('Заявки та повідомлення (e2e)', () => {
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

  it('приймає заявку з форми сайту й нормалізує телефон', async () => {
    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, reference: 'Будинок «Садовий»' })
      .expect(201);

    const list = await owner.get('/admin/requests').expect(200);

    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      buildingType: 'HOUSE',
      phone: '+380501234567',
      status: 'NEW',
      reference: 'Будинок «Садовий»',
    });
  });

  it('привʼязує заявку до проєкту за назвою', async () => {
    const project = await owner
      .post('/admin/projects')
      .send({ title: 'Будинок «Садовий»', buildingType: 'Приватний будинок' })
      .expect(201);

    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, reference: 'Будинок «Садовий»' })
      .expect(201);

    const list = await owner.get('/admin/requests').expect(200);

    expect(list.body.data[0].project).toMatchObject({ id: project.body.id });
  });

  it('відхиляє заявку без згоди й з поганими даними', async () => {
    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, consent: false })
      .expect(400);

    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, buildingType: 'castle' })
      .expect(400);

    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, email: 'not-an-email' })
      .expect(400);
  });

  it('мовчки ігнорує заявку, у якій заповнено поле-пастку', async () => {
    await testApp.visitor
      .post('/public/requests')
      .send({ ...validRequest, website: 'http://spam.example' })
      .expect(201);

    const list = await owner.get('/admin/requests').expect(200);

    expect(list.body.meta.total).toBe(0);
  });

  it('змінює статус і нотатку заявки, видаляє її', async () => {
    await testApp.visitor
      .post('/public/requests')
      .send(validRequest)
      .expect(201);

    const id = (await owner.get('/admin/requests').expect(200)).body.data[0].id;

    const updated = await owner
      .patch(`/admin/requests/${id}`)
      .send({ status: 'IN_PROGRESS', note: 'Передзвонити завтра' })
      .expect(200);

    expect(updated.body).toMatchObject({
      status: 'IN_PROGRESS',
      note: 'Передзвонити завтра',
    });

    await owner.delete(`/admin/requests/${id}`).expect(200);
    await owner.get(`/admin/requests/${id}`).expect(404);
  });

  it('приймає повідомлення з контактів і показує його в зведенні', async () => {
    await testApp.visitor
      .post('/public/messages')
      .send({
        name: 'Іван',
        phone: '0671234567',
        message: 'Доброго дня, хочу консультацію',
      })
      .expect(201);
    await testApp.visitor
      .post('/public/requests')
      .send(validRequest)
      .expect(201);

    const summary = await owner.get('/admin/summary').expect(200);

    expect(summary.body).toMatchObject({ newRequests: 1, newMessages: 1 });

    const messages = await owner.get('/admin/messages').expect(200);

    await owner
      .patch(`/admin/messages/${messages.body.data[0].id}`)
      .send({ status: 'READ' })
      .expect(200);

    const after = await owner.get('/admin/summary').expect(200);

    expect(after.body.newMessages).toBe(0);
  });
});
