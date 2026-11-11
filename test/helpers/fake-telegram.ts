import crypto from 'node:crypto';

export const TOKEN = 'test-token';

export const WEBHOOK_SECRET = crypto
  .createHash('sha256')
  .update(`webhook:${TOKEN}`)
  .digest('hex');

export interface Call {
  method: string;
  body: Record<string, any>;
  files?: { field: string; filename: string; mimeType: string; size: number }[];
}

// Фейк замість справжнього Telegram: записує виклики й нічого нікуди не надсилає.
export class FakeTelegramApi {
  calls: Call[] = [];

  getToken() {
    return TOKEN;
  }

  getBotUsername() {
    return 'test_bot';
  }

  isConfigured() {
    return true;
  }

  call(method: string, body: Record<string, any> = {}) {
    this.calls.push({ method, body });

    return Promise.resolve({});
  }

  upload(
    method: string,
    body: Record<string, any>,
    files: {
      field: string;
      filename: string;
      mimeType: string;
      content: Buffer;
    }[],
  ) {
    this.calls.push({
      method,
      body,
      files: files.map((file) => ({
        field: file.field,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.content.length,
      })),
    });

    return Promise.resolve({});
  }

  reset() {
    this.calls = [];
  }

  sent(method: string) {
    return this.calls.filter((call) => call.method === method);
  }

  lastMessage() {
    return this.sent('sendMessage').at(-1);
  }
}
