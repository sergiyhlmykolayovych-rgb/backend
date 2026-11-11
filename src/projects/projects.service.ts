import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { buildMeta } from '../common/pagination.js';
import { toSlug } from '../common/slug.js';
import {
  IMAGE_TYPES,
  MAX_PROJECT_FILE_SIZE,
  PDF_TYPES,
  describeUpload,
  type UploadedFileData,
} from '../common/uploads.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStorageService } from '../storage/file-storage.service.js';

import {
  MAX_PROJECT_IMAGES,
  type CreateProjectDto,
  type ProjectsQueryDto,
  type ReorderIdsDto,
  type UpdateImageDto,
  type UpdateProjectDto,
} from './dto/project.dto.js';

// Фото йдуть у заданому порядку: перше — обкладинка. Ключі сховища назовні не віддаємо.
const imageOrder = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.ProjectImageOrderByWithRelationInput[];

const images = {
  select: { id: true, alt: true, position: true },
  orderBy: imageOrder,
} satisfies Prisma.Project$imagesArgs;

const projectSelect = {
  id: true,
  slug: true,
  title: true,
  category: true,
  buildingType: true,
  location: true,
  year: true,
  area: true,
  status: true,
  scope: true,
  intro: true,
  concept: true,
  isPublished: true,
  isFeatured: true,
  position: true,
  price: true,
  // Ключ файлу в сховищі назовні не віддаємо: PDF бачить лише сервер і бот.
  fileName: true,
  fileSize: true,
  fileUrl: true,
  createdAt: true,
  updatedAt: true,
  images,
  _count: { select: { requests: true } },
} satisfies Prisma.ProjectSelect;

// Що бачить відвідувач сайту: без службових полів, категорія в тому ж записі, що й на сайті.
const publicSelect = {
  slug: true,
  title: true,
  category: true,
  buildingType: true,
  location: true,
  year: true,
  area: true,
  status: true,
  scope: true,
  intro: true,
  concept: true,
  isFeatured: true,
  // Потрібні лише щоб визначити, чи проєкт продається; у відповідь вони не потрапляють.
  price: true,
  fileKey: true,
  fileUrl: true,
  images: {
    select: { id: true, alt: true },
    orderBy: imageOrder,
  },
} satisfies Prisma.ProjectSelect;

type PublicProject = Prisma.ProjectGetPayload<{ select: typeof publicSelect }>;

const toPublic = (project: PublicProject) => {
  const { price, fileKey, fileUrl, ...rest } = project;
  const forSale = price !== null && Boolean(fileKey || fileUrl);

  return {
    ...rest,
    category: project.category.toLowerCase(),
    // Сайт показує ціну й кнопку «Купити» лише для проєктів, які справді можна купити.
    forSale,
    price: forSale ? Number(price) : null,
  };
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
  ) {}

  // Проєкти для сайту: лише опубліковані й лише ті, у яких є хоча б одне фото.
  async findPublished() {
    const projects = await this.prisma.project.findMany({
      where: { isPublished: true, images: { some: {} } },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      select: publicSelect,
    });

    return projects.map(toPublic);
  }

  async findPublishedBySlug(slug: string) {
    const project = await this.prisma.project.findFirst({
      where: { slug, isPublished: true, images: { some: {} } },
      select: publicSelect,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return toPublic(project);
  }

  async findAll(query: ProjectsQueryDto) {
    const { page, limit, search, category, published } = query;

    const where: Prisma.ProjectWhereInput = {
      ...(category && { category }),
      ...(published && { isPublished: published === 'true' }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: projectSelect,
      }),
      this.prisma.project.count({ where }),
    ]);

    return { data, meta: buildMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: projectSelect,
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async create(dto: CreateProjectDto) {
    const slug = await this.uniqueSlug(
      dto.slug ?? toSlug(dto.title),
      !dto.slug,
    );

    // Новий проєкт стає першим у списку.
    const first = await this.prisma.project.aggregate({
      _min: { position: true },
    });

    return this.prisma.project.create({
      data: {
        slug,
        title: dto.title,
        category: dto.category,
        buildingType: dto.buildingType,
        location: dto.location || null,
        year: dto.year ?? null,
        area: dto.area || null,
        status: dto.status || null,
        scope: dto.scope || null,
        intro: dto.intro ?? '',
        concept: dto.concept ?? '',
        isPublished: dto.isPublished ?? false,
        isFeatured: dto.isFeatured ?? false,
        price: dto.price ?? null,
        fileUrl: dto.fileUrl || null,
        position: (first._min.position ?? 0) - 1,
      },
      select: projectSelect,
    });
  }

  async update(id: string, dto: UpdateProjectDto) {
    const current = await this.findOne(id);

    if (dto.slug && dto.slug !== current.slug) {
      await this.uniqueSlug(dto.slug, false, id);
    }

    // Посилання на Диск замінює завантажений PDF: одночасно діє лише один спосіб передачі.
    const replacesFile = Boolean(dto.fileUrl) && current.fileName !== null;
    const oldFileKey = replacesFile ? await this.getFileKey(id) : null;

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        slug: dto.slug,
        title: dto.title,
        category: dto.category,
        buildingType: dto.buildingType,
        // Порожній рядок очищає необовʼязкове поле.
        location: dto.location === undefined ? undefined : dto.location || null,
        year: dto.year,
        area: dto.area === undefined ? undefined : dto.area || null,
        status: dto.status === undefined ? undefined : dto.status || null,
        scope: dto.scope === undefined ? undefined : dto.scope || null,
        intro: dto.intro,
        concept: dto.concept,
        isPublished: dto.isPublished,
        isFeatured: dto.isFeatured,
        price: dto.price,
        fileUrl: dto.fileUrl === undefined ? undefined : dto.fileUrl || null,
        ...(replacesFile && { fileKey: null, fileName: null, fileSize: null }),
      },
      select: projectSelect,
    });

    if (oldFileKey) {
      await this.storage.remove(oldFileKey);
    }

    return updated;
  }

  async remove(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        fileKey: true,
        images: { select: { fileKey: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    await this.prisma.project.delete({ where: { id } });
    await Promise.all([
      ...project.images.map((image) => this.storage.remove(image.fileKey)),
      ...(project.fileKey ? [this.storage.remove(project.fileKey)] : []),
    ]);

    return { success: true };
  }

  async reorder(dto: ReorderIdsDto) {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.project.updateMany({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    return { success: true };
  }

  async addImage(projectId: string, file: UploadedFileData | undefined) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const project = await this.findOne(projectId);

    if (project.images.length >= MAX_PROJECT_IMAGES) {
      throw new BadRequestException(
        `До проєкту можна додати не більше ${MAX_PROJECT_IMAGES} фото`,
      );
    }

    const { extension, mimeType } = describeUpload(
      file,
      IMAGE_TYPES,
      'Додайте фото у форматі JPG, PNG або WebP',
    );

    const fileKey = `projects/${projectId}/${randomUUID()}${extension}`;

    await this.storage.put(fileKey, file.buffer, mimeType);

    const last = project.images[project.images.length - 1];

    return this.prisma.projectImage.create({
      data: {
        projectId,
        fileKey,
        mimeType,
        alt: '',
        position: last ? last.position + 1 : 0,
      },
      select: { id: true, alt: true, position: true },
    });
  }

  async updateImage(projectId: string, imageId: string, dto: UpdateImageDto) {
    await this.getImageRecord(projectId, imageId);

    return this.prisma.projectImage.update({
      where: { id: imageId },
      data: { alt: dto.alt },
      select: { id: true, alt: true, position: true },
    });
  }

  async reorderImages(projectId: string, dto: ReorderIdsDto) {
    const project = await this.findOne(projectId);
    const known = new Set(project.images.map((image) => image.id));

    if (dto.ids.length !== known.size || dto.ids.some((id) => !known.has(id))) {
      throw new ConflictException(
        'The list must contain every photo of the project',
      );
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.projectImage.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    return this.findOne(projectId);
  }

  // PDF для покупця. Лежить у закритому сховищі й віддається лише власнику з адмінки (і згодом боту).
  async setFile(projectId: string, file: UploadedFileData | undefined) {
    if (!file) {
      throw new BadRequestException('PDF file is required');
    }

    await this.findOne(projectId);

    const { fileName, mimeType } = describeUpload(
      file,
      PDF_TYPES,
      'Додайте файл у форматі PDF',
      MAX_PROJECT_FILE_SIZE,
    );

    const fileKey = `project-files/${projectId}/${randomUUID()}.pdf`;
    const oldFileKey = await this.getFileKey(projectId);

    await this.storage.put(fileKey, file.buffer, mimeType);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      // Завантажений PDF замінює посилання на Диск.
      data: {
        fileKey,
        fileName,
        fileSize: file.size,
        fileUrl: null,
      },
      select: projectSelect,
    });

    if (oldFileKey) {
      await this.storage.remove(oldFileKey);
    }

    return updated;
  }

  async removeFile(projectId: string) {
    await this.findOne(projectId);

    const fileKey = await this.getFileKey(projectId);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { fileKey: null, fileName: null, fileSize: null },
      select: projectSelect,
    });

    if (fileKey) {
      await this.storage.remove(fileKey);
    }

    return updated;
  }

  // Потік PDF для власника (перевірити, що завантажилось правильно).
  async getFile(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { fileKey: true, fileName: true },
    });

    const stream = project?.fileKey
      ? await this.storage.get(project.fileKey)
      : null;

    if (!project || !stream) {
      throw new NotFoundException('Project file not found');
    }

    return { stream, fileName: project.fileName ?? 'project.pdf' };
  }

  private async getFileKey(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { fileKey: true },
    });

    return project?.fileKey ?? null;
  }

  async removeImage(projectId: string, imageId: string) {
    const image = await this.getImageRecord(projectId, imageId);

    await this.prisma.projectImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.fileKey);

    return { success: true };
  }

  // Файл фото для сайту й адмінки. Ідентифікатор фото невгадуваний, тож окремого входу не потрібно.
  async getImage(imageId: string) {
    const image = await this.prisma.projectImage.findUnique({
      where: { id: imageId },
      select: { fileKey: true, mimeType: true },
    });

    const stream = image ? await this.storage.get(image.fileKey) : null;

    if (!image || !stream) {
      throw new NotFoundException('Image not found');
    }

    return { stream, mimeType: image.mimeType };
  }

  private async getImageRecord(projectId: string, imageId: string) {
    const image = await this.prisma.projectImage.findFirst({
      where: { id: imageId, projectId },
      select: { id: true, fileKey: true },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    return image;
  }

  // Явно задану адресу, що вже зайнята, не змінюємо: це помилка. Згенеровану з назви — доповнюємо числом.
  private async uniqueSlug(
    base: string,
    autoSuffix: boolean,
    exceptId?: string,
  ) {
    let candidate = base;

    for (let attempt = 2; attempt < 100; attempt++) {
      const existing = await this.prisma.project.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing || existing.id === exceptId) {
        return candidate;
      }

      if (!autoSuffix) {
        throw new ConflictException('Project with this slug already exists');
      }

      candidate = `${base}-${attempt}`;
    }

    throw new ConflictException('Could not generate a unique slug');
  }
}
