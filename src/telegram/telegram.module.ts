import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';

import { BotService } from './bot.service.js';
import { DeliveryService } from './delivery.service.js';
import { PaymentService } from './payment.service.js';
import { TelegramApiService } from './telegram-api.service.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

@Module({
  imports: [StorageModule],
  controllers: [TelegramController],
  providers: [
    TelegramApiService,
    DeliveryService,
    PaymentService,
    BotService,
    TelegramService,
  ],
  exports: [DeliveryService],
})
export class TelegramModule {}
