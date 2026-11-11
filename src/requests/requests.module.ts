import { Module } from '@nestjs/common';

import { TurnstileModule } from '../turnstile/turnstile.module.js';

import {
  AdminRequestsController,
  PublicRequestsController,
} from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [TurnstileModule],
  controllers: [PublicRequestsController, AdminRequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
