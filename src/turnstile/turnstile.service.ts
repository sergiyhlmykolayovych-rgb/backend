import { Injectable, Logger } from '@nestjs/common';

// Перевірка «я не робот» від Cloudflare Turnstile для публічних форм.
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token?: string): Promise<boolean> {
    const secretKey = (process.env.TURNSTILE_SECRET_KEY ?? '').trim();

    // Без ключа (локальна розробка, тести) перевірка пропускається.
    if (!secretKey) {
      return true;
    }

    if (!token) {
      return false;
    }

    try {
      const response = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: secretKey, response: token }),
        },
      );

      const data = (await response.json()) as { success: boolean };

      return data.success;
    } catch (error) {
      this.logger.error(`Помилка перевірки Turnstile: ${String(error)}`);

      return false;
    }
  }
}
