import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { TelegramService } from './telegram.service.js';
import type { TelegramUpdate } from './telegram.types.js';

@Controller({
  path: 'telegram',
  version: '1',
})
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  // Сюди пише сам Telegram. Входу немає: запит перевіряється секретом у заголовку.
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  handleUpdate(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    return this.telegramService.handleUpdate(secret, update);
  }
}
