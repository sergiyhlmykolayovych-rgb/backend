import { Injectable } from '@nestjs/common';

const TELEGRAM_TIMEOUT_MS = 15_000;
// Завантаження файлів (альбом, PDF) триває довше за звичайний запит.
const TELEGRAM_UPLOAD_TIMEOUT_MS = 120_000;

export interface TelegramFile {
  field: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Тонка обгортка над HTTP API Telegram. Уся логіка бота викликає Telegram лише через неї,
// тому в тестах її підміняють фейком і ніхто нічого не надсилає справжньому боту.
@Injectable()
export class TelegramApiService {
  private read(name: string) {
    return (process.env[name] ?? '').trim();
  }

  getToken() {
    return this.read('TELEGRAM_BOT_TOKEN');
  }

  getBotUsername() {
    return this.read('TELEGRAM_BOT_USERNAME').replace(/^@/, '');
  }

  isConfigured() {
    return Boolean(this.getToken() && this.getBotUsername());
  }

  private url(method: string) {
    return `https://api.telegram.org/bot${this.getToken()}/${method}`;
  }

  private async parse<T>(method: string, response: Response): Promise<T> {
    if (!response.ok) {
      throw new TelegramApiError(
        `Telegram ${method} відповів ${response.status}: ${await response.text()}`,
        response.status,
      );
    }

    const data = (await response.json()) as { result: T };

    return data.result;
  }

  async call<T = unknown>(
    method: string,
    body: Record<string, unknown> = {},
    timeoutMs = TELEGRAM_TIMEOUT_MS,
  ): Promise<T> {
    const response = await fetch(this.url(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return this.parse<T>(method, response);
  }

  // Запит з файлами (multipart): значення полів, що не рядки, передаються як JSON.
  async upload<T = unknown>(
    method: string,
    fields: Record<string, unknown>,
    files: TelegramFile[],
  ): Promise<T> {
    const form = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      form.append(
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    }

    for (const file of files) {
      form.append(
        file.field,
        new Blob([new Uint8Array(file.content)], { type: file.mimeType }),
        file.filename,
      );
    }

    const response = await fetch(this.url(method), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TELEGRAM_UPLOAD_TIMEOUT_MS),
    });

    return this.parse<T>(method, response);
  }
}
