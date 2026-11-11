import { Module } from '@nestjs/common';

import { TurnstileModule } from '../turnstile/turnstile.module.js';

import {
  AdminMessagesController,
  PublicMessagesController,
} from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [TurnstileModule],
  controllers: [PublicMessagesController, AdminMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
