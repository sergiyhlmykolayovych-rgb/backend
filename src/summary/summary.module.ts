import { Module } from '@nestjs/common';

import { SummaryController } from './summary.controller.js';

@Module({
  controllers: [SummaryController],
})
export class SummaryModule {}
