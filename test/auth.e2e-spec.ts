import {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  createTestApp,
  type TestApp,
} from './helpers/test-app.js';

describe('Вхід в адмінку (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await testApp.resetData();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('не пускає без токена в адмінські маршрути', async () => {
    await testApp.visitor.get('/admin/projects').expect(401);
    await testApp.visitor.get('/admin/requests').expect(401);
    await testApp.visitor.get('/admin/messages').expect(401);
    await testApp.visitor.get('/admin/summary').expect(401);
  });

  it('входить, повертає профіль і оновлює токен за кукою', async () => {
    const owner = await testApp.loginAsOwner();

    const me = await owner.get('/auth/me').expect(200);

    expect(me.body).toMatchObject({ email: OWNER_EMAIL, roles: ['OWNER'] });

    const login = await testApp.visitor
      .post('/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
      .expect(201);

    const cookies = login.headers['set-cookie'] as unknown as string[];

    expect(cookies.some((cookie) => cookie.startsWith('refresh_token='))).toBe(
      true,
    );

    const refreshed = await testApp.visitor
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(201);

    expect(refreshed.body.accessToken).toEqual(expect.any(String));

    // Той самий refresh-токен вдруге вже не працює: його замінено новим.
    await testApp.visitor
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
  });

  it('відхиляє неправильний пароль', async () => {
    await testApp.loginAsOwner();

    await testApp.visitor
      .post('/auth/login')
      .send({ email: OWNER_EMAIL, password: 'wrong-password' })
      .expect(401);
  });

  it('змінює пароль і закриває сесії', async () => {
    const owner = await testApp.loginAsOwner();

    await owner
      .post('/auth/change-password')
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'new-password-2' })
      .expect(201);

    await testApp.visitor
      .post('/auth/login')
      .send({ email: OWNER_EMAIL, password: 'new-password-2' })
      .expect(201);
  });
});
