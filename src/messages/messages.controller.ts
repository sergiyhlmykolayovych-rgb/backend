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
  CreateMessageDto,
  MessagesQueryDto,
  UpdateMessageDto,
} from './dto/message.dto.js';
import { MessagesService } from './messages.service.js';

// Відкрита частина: форма на сторінці «Контакти».
@Controller({
  path: 'public/messages',
  version: '1',
})
export class PublicMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateMessageDto) {
    return this.messagesService.create(dto);
  }
}

@Controller({
  path: 'admin/messages',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class AdminMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  findAll(@Query() query: MessagesQueryDto) {
    return this.messagesService.findAll(query);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.messagesService.remove(id);
  }
}
