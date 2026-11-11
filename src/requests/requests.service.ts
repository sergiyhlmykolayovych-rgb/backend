import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { buildMeta } from '../common/pagination.js';
import { normalizePhone } from '../common/phone.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RequestStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TurnstileService } from '../turnstile/turnstile.service.js';

import type {
  CreateRequestDto,
  RequestsQueryDto,
  UpdateRequestDto,
} from './dto/request.dto.js';

const requestSelect = {
  id: true,
  buildingType: true,
  area: true,
  location: true,
  stage: true,
  scope: true,
  budget: true,
  style: true,
  floors: true,
  siteInfo: true,
  requirements: true,
  name: true,
  phone: true,
  email: true,
  message: true,
  reference: true,
  projectId: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, title: true, slug: true } },
} satisfies Prisma.ProjectRequestSelect;

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
  ) {}

  async create(dto: CreateRequestDto) {
    // Бот заповнив прихований елемент: вдаємо успіх, але нічого не зберігаємо.
    if (dto.website) {
      return { success: true };
    }

    if (!(await this.turnstile.verify(dto.turnstileToken))) {
      throw new BadRequestException(
        'Не вдалося пройти перевірку «я не робот». Спробуйте ще раз',
      );
    }

    const reference = dto.reference ?? '';
    const project = reference
      ? await this.prisma.project.findFirst({
          where: { title: reference },
          select: { id: true },
        })
      : null;

    await this.prisma.projectRequest.create({
      data: {
        buildingType:
          dto.buildingType.toUpperCase() as Prisma.ProjectRequestCreateInput['buildingType'],
        area: dto.area ?? '',
        location: dto.location ?? '',
        stage: dto.stage ?? '',
        scope: dto.scope ?? '',
        budget: dto.budget ?? '',
        style: dto.style ?? '',
        floors: dto.floors ?? '',
        siteInfo: dto.siteInfo ?? '',
        requirements: dto.requirements ?? '',
        name: dto.name,
        phone: normalizePhone(dto.phone) ?? dto.phone,
        email: dto.email ?? '',
        message: dto.message ?? '',
        reference,
        projectId: project?.id ?? null,
        privacyAcceptedAt: new Date(),
      },
    });

    return { success: true };
  }

  async findAll(query: RequestsQueryDto) {
    const { page, limit, search, status } = query;
    const digits = search?.replace(/\D/g, '') ?? '';

    const where: Prisma.ProjectRequestWhereInput = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.projectRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: requestSelect,
      }),
      this.prisma.projectRequest.count({ where }),
    ]);

    return { data, meta: buildMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const request = await this.prisma.projectRequest.findUnique({
      where: { id },
      select: requestSelect,
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return request;
  }

  async update(id: string, dto: UpdateRequestDto) {
    await this.findOne(id);

    return this.prisma.projectRequest.update({
      where: { id },
      data: {
        status: dto.status,
        note: dto.note === undefined ? undefined : dto.note || null,
      },
      select: requestSelect,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.projectRequest.delete({ where: { id } });

    return { success: true };
  }

  countNew() {
    return this.prisma.projectRequest.count({
      where: { status: RequestStatus.NEW },
    });
  }
}
