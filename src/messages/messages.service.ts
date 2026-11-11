import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { buildMeta } from '../common/pagination.js';
import { normalizePhone } from '../common/phone.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MessageStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TurnstileService } from '../turnstile/turnstile.service.js';

import type {
  CreateMessageDto,
  MessagesQueryDto,
  UpdateMessageDto,
} from './dto/message.dto.js';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
  ) {}

  async create(dto: CreateMessageDto) {
    // Бот заповнив прихований елемент: вдаємо успіх, але нічого не зберігаємо.
    if (dto.website) {
      return { success: true };
    }

    if (!(await this.turnstile.verify(dto.turnstileToken))) {
      throw new BadRequestException(
        'Не вдалося пройти перевірку «я не робот». Спробуйте ще раз',
      );
    }

    await this.prisma.contactMessage.create({
      data: {
        name: dto.name,
        phone: normalizePhone(dto.phone) ?? dto.phone,
        message: dto.message,
      },
    });

    return { success: true };
  }

  async findAll(query: MessagesQueryDto) {
    const { page, limit, search, status } = query;
    const digits = search?.replace(/\D/g, '') ?? '';

    const where: Prisma.ContactMessageWhereInput = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { message: { contains: search, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contactMessage.count({ where }),
    ]);

    return { data, meta: buildMeta(page, limit, total) };
  }

  async update(id: string, dto: UpdateMessageDto) {
    await this.findOne(id);

    return this.prisma.contactMessage.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.contactMessage.delete({ where: { id } });

    return { success: true };
  }

  countNew() {
    return this.prisma.contactMessage.count({
      where: { status: MessageStatus.NEW },
    });
  }

  private async findOne(id: string) {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }
}
