import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

// Сховище файлів сайту (фото до заявок, відгуків і портфоліо). Коли задано змінні R2_*,
// файли лежать у Cloudflare R2 (сумісне з S3): вони не залежать від сервера й переживають
// будь-який деплой. Без цих змінних файли пишуться на диск у UPLOADS_DIR — так працюють
// локальна розробка й тести. У сайту власний bucket, окремий від ERP.
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  private client: S3Client | null = null;

  // Значення зі змінних середовища без пробілів і переносів рядка по краях: їх легко
  // зачепити під час копіювання, а ключ із зайвим символом ламає підпис запиту.
  private read(name: string) {
    return (process.env[name] ?? '').trim();
  }

  // Адресу сховища можна задати цілком (R2_ENDPOINT) або лише ідентифікатором акаунта.
  private getEndpoint() {
    const endpoint = this.read('R2_ENDPOINT');

    if (endpoint) {
      return endpoint;
    }

    const accountId = this.read('R2_ACCOUNT_ID');

    return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '';
  }

  private isRemote() {
    return Boolean(
      this.getEndpoint() &&
      this.read('R2_ACCESS_KEY_ID') &&
      this.read('R2_SECRET_ACCESS_KEY') &&
      this.read('R2_BUCKET'),
    );
  }

  private getClient() {
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto',
        // R2 не потребує додаткових контрольних сум, які нові версії SDK додають самі:
        // без цього частина запитів відхиляється.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        endpoint: this.getEndpoint(),
        credentials: {
          accessKeyId: this.read('R2_ACCESS_KEY_ID'),
          secretAccessKey: this.read('R2_SECRET_ACCESS_KEY'),
        },
      });
    }

    return this.client;
  }

  private getBucket() {
    return this.read('R2_BUCKET');
  }

  private getLocalPath(key: string) {
    return path.join(path.resolve(process.env.UPLOADS_DIR ?? 'uploads'), key);
  }

  async put(key: string, content: Buffer, mimeType: string) {
    if (this.isRemote()) {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
          Body: content,
          ContentType: mimeType,
        }),
      );

      return;
    }

    const filePath = this.getLocalPath(key);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  // Повертає потік файлу або null, якщо у сховищі його немає.
  async get(key: string): Promise<Readable | null> {
    if (this.isRemote()) {
      try {
        const response = await this.getClient().send(
          new GetObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
          }),
        );

        return (response.Body as Readable | undefined) ?? null;
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') {
          return null;
        }

        throw error;
      }
    }

    const filePath = this.getLocalPath(key);

    try {
      await stat(filePath);
    } catch {
      return null;
    }

    return createReadStream(filePath);
  }

  // Помилка видалення не зупиняє роботу: запис у базі вже прибрано, зайвий файл не шкодить.
  async remove(key: string) {
    try {
      if (this.isRemote()) {
        await this.getClient().send(
          new DeleteObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
          }),
        );

        return;
      }

      await rm(this.getLocalPath(key), { force: true });
    } catch (error) {
      this.logger.warn(`Не вдалося видалити файл ${key}: ${String(error)}`);
    }
  }
}
