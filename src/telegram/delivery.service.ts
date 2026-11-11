import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { FileStorageService } from '../storage/file-storage.service.js';

import { TelegramApiService } from './telegram-api.service.js';
import { escapeHtml } from './telegram.format.js';
import { streamToBuffer } from './telegram.util.js';

// Видача проєкту покупцю: PDF як документ у чат або кнопка з посиланням на Google Диск.
// Викликається після підтвердженої оплати та з команди «Мої покупки».
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly api: TelegramApiService,
  ) {}

  async deliverProject(
    chatId: number | string,
    projectId: string,
  ): Promise<'file' | 'link'> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, fileKey: true, fileName: true, fileUrl: true },
    });

    if (!project || (!project.fileKey && !project.fileUrl)) {
      throw new NotFoundException('Project has nothing to deliver');
    }

    const caption = `Ваш проєкт: <b>${escapeHtml(project.title)}</b>\nДякуємо за покупку!`;

    if (project.fileKey) {
      const stream = await this.storage.get(project.fileKey);

      if (!stream) {
        throw new NotFoundException('Project file not found in storage');
      }

      await this.api.upload(
        'sendDocument',
        { chat_id: chatId, caption, parse_mode: 'HTML' },
        [
          {
            field: 'document',
            filename: project.fileName ?? 'project.pdf',
            mimeType: 'application/pdf',
            content: await streamToBuffer(stream),
          },
        ],
      );

      return 'file';
    }

    await this.api.call('sendMessage', {
      chat_id: chatId,
      text: `${caption}\n\nФайл проєкту завеликий для чату, тому він лежить на Google Диску.`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Відкрити проєкт', url: project.fileUrl as string }],
        ],
      },
    });

    return 'link';
  }
}
