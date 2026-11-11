import { BadRequestException } from '@nestjs/common';
import path from 'node:path';

// Те, що multer кладе в памʼять після розбору multipart-запиту.
export type UploadedFileData = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

// Файл проєкту для покупця: Telegram дозволяє боту надсилати документи до 50 МБ.
// Більші файли дають посиланням на Google Диск.
export const MAX_PROJECT_FILE_SIZE = 50 * 1024 * 1024;

export const PDF_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
};

// Тип файлу визначаємо за розширенням зі списку, а не за тим, що надіслав браузер:
// так у сховище не потрапить HTML чи SVG, які браузер міг би виконати.
export const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

// До заявки можна додати ще й планування в PDF.
export const LEAD_FILE_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  '.pdf': 'application/pdf',
};

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (text: string) => Array.from(Buffer.from(text, 'ascii'));

// Розширення легко підробити, тому звіряємо його з початком самого файлу:
// у кожного формату там свій підпис.
const SIGNATURES: Record<string, (buffer: Buffer) => boolean> = {
  '.jpg': (buffer) => startsWith(buffer, [0xff, 0xd8, 0xff]),
  '.jpeg': (buffer) => startsWith(buffer, [0xff, 0xd8, 0xff]),
  '.png': (buffer) =>
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.webp': (buffer) =>
    startsWith(buffer, ascii('RIFF')) && startsWith(buffer, ascii('WEBP'), 8),
  // Фото з iPhone: різновидів формату багато, тому перевіряємо лише спільну частину.
  '.heic': (buffer) => startsWith(buffer, ascii('ftyp'), 4),
  '.heif': (buffer) => startsWith(buffer, ascii('ftyp'), 4),
  // Заголовок PDF може стояти не з першого байта.
  '.pdf': (buffer) => buffer.subarray(0, 1024).includes('%PDF-'),
};

export const BAD_CONTENT_ERROR =
  'Файл пошкоджений або має не той формат. Спробуйте інший файл';

// Браузери надсилають імʼя файлу в latin1: повертаємо кирилицю й прибираємо небезпечні символи.
export function readFileName(file: UploadedFileData) {
  return Buffer.from(file.originalname, 'latin1')
    .toString('utf8')
    .replace(/[\\/\0]/g, '_')
    .slice(-255);
}

// Перевіряє файл і повертає його імʼя, розширення та тип зі списку дозволених.
export function describeUpload(
  file: UploadedFileData,
  allowedTypes: Record<string, string>,
  errorMessage: string,
  maxSize = MAX_UPLOAD_SIZE,
) {
  const fileName = readFileName(file);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = allowedTypes[extension];

  if (!mimeType) {
    throw new BadRequestException(errorMessage);
  }

  if (file.size > maxSize) {
    throw new BadRequestException(
      `Файл завеликий: максимум ${Math.round(maxSize / (1024 * 1024))} МБ`,
    );
  }

  if (!SIGNATURES[extension]?.(file.buffer)) {
    throw new BadRequestException(BAD_CONTENT_ERROR);
  }

  return { fileName, extension, mimeType };
}
