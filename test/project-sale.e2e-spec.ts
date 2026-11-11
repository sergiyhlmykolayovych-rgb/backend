import {
  createTestApp,
  type ApiClient,
  type TestApp,
} from './helpers/test-app.js';

// Мінімальний PDF: сервер перевіряє лише підпис «%PDF-» на початку файлу.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);

const DRIVE_LINK = 'https://drive.google.com/file/d/abc123/view?usp=sharing';

describe('Продаж проєкту: ціна та файл (e2e)', () => {
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

  async function createProject(extra: Record<string, unknown> = {}) {
    const response = await owner
      .post('/admin/projects')
      .send({
        title: 'Проєкт на продаж',
        buildingType: 'Приватний будинок',
        isPublished: true,
        ...extra,
      })
      .expect(201);

    return response.body as { id: string };
  }

  function uploadFile(projectId: string, content: Buffer, name: string) {
    return owner
      .post(`/admin/projects/${projectId}/file`)
      .attach('file', content, name);
  }

  it('зберігає ціну й дозволяє її прибрати', async () => {
    const project = await createProject({ price: 4500.5 });

    const created = await owner
      .get(`/admin/projects/${project.id}`)
      .expect(200);

    expect(created.body.price).toBe('4500.5');

    const cleared = await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ price: null })
      .expect(200);

    expect(cleared.body.price).toBeNull();

    await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ price: -1 })
      .expect(400);
  });

  it('приймає PDF і не віддає ключ сховища', async () => {
    const project = await createProject();

    const response = await uploadFile(
      project.id,
      PDF,
      'Проєкт будинку.pdf',
    ).expect(201);

    expect(response.body).toMatchObject({
      fileName: 'Проєкт будинку.pdf',
      fileSize: PDF.length,
      fileUrl: null,
    });
    expect(response.body.fileKey).toBeUndefined();
  });

  it('відхиляє не-PDF і підроблений PDF', async () => {
    const project = await createProject();

    await uploadFile(project.id, Buffer.from('plain'), 'doc.docx').expect(400);
    await uploadFile(project.id, Buffer.from('not a pdf'), 'fake.pdf').expect(
      400,
    );
  });

  it('віддає PDF лише власнику й лише з файлом', async () => {
    const project = await createProject();

    await owner.get(`/admin/projects/${project.id}/file`).expect(404);
    await uploadFile(project.id, PDF, 'plan.pdf').expect(201);

    const download = await owner
      .get(`/admin/projects/${project.id}/file`)
      .expect(200);

    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('plan.pdf');

    await testApp.visitor.get(`/admin/projects/${project.id}/file`).expect(401);
  });

  it('не показує на сайті ні файл, ні посилання, ні назву файлу', async () => {
    const project = await createProject({ price: 1000 });

    await uploadFile(project.id, PDF, 'plan.pdf').expect(201);
    await owner
      .post(`/admin/projects/${project.id}/images`)
      .attach(
        'image',
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64',
        ),
        'photo.png',
      )
      .expect(201);

    const list = await testApp.visitor.get('/public/projects').expect(200);

    expect(list.body).toHaveLength(1);

    const keys = Object.keys(list.body[0]);

    for (const secret of ['fileKey', 'fileName', 'fileSize', 'fileUrl']) {
      expect(keys).not.toContain(secret);
    }
  });

  it('приймає лише посилання Google Диск, а порожнє прибирає', async () => {
    const project = await createProject();

    await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ fileUrl: 'https://example.com/file.pdf' })
      .expect(400);

    await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ fileUrl: 'http://drive.google.com/file/d/1' })
      .expect(400);

    const saved = await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ fileUrl: DRIVE_LINK })
      .expect(200);

    expect(saved.body.fileUrl).toBe(DRIVE_LINK);

    const cleared = await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ fileUrl: '' })
      .expect(200);

    expect(cleared.body.fileUrl).toBeNull();
  });

  it('PDF і посилання замінюють одне одного', async () => {
    const project = await createProject();

    await uploadFile(project.id, PDF, 'plan.pdf').expect(201);

    const withLink = await owner
      .patch(`/admin/projects/${project.id}`)
      .send({ fileUrl: DRIVE_LINK })
      .expect(200);

    expect(withLink.body).toMatchObject({
      fileUrl: DRIVE_LINK,
      fileName: null,
      fileSize: null,
    });

    await owner.get(`/admin/projects/${project.id}/file`).expect(404);

    const withFile = await uploadFile(project.id, PDF, 'again.pdf').expect(201);

    expect(withFile.body).toMatchObject({
      fileName: 'again.pdf',
      fileUrl: null,
    });
  });

  it('видаляє PDF окремо від проєкту', async () => {
    const project = await createProject();

    await uploadFile(project.id, PDF, 'plan.pdf').expect(201);

    const removed = await owner
      .delete(`/admin/projects/${project.id}/file`)
      .expect(200);

    expect(removed.body).toMatchObject({ fileName: null, fileSize: null });
    await owner.get(`/admin/projects/${project.id}/file`).expect(404);
  });
});
