import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import {
  CreateRequestDto,
  RequestsQueryDto,
  UpdateRequestDto,
} from './dto/request.dto.js';
import { RequestsService } from './requests.service.js';

// Відкрита частина: форма «Замовити проєкт» на сайті.
@Controller({
  path: 'public/requests',
  version: '1',
})
export class PublicRequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  // Не більше 5 заявок на хвилину з однієї адреси.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateRequestDto) {
    return this.requestsService.create(dto);
  }
}

@Controller({
  path: 'admin/requests',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class AdminRequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  findAll(@Query() query: RequestsQueryDto) {
    return this.requestsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.requestsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
  ) {
    return this.requestsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.requestsService.remove(id);
  }
}
