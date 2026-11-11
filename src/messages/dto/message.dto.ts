import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PageQueryDto } from '../../common/pagination.js';
import { MessageStatus } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(30)
  phone!: string;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message!: string;

  // Поле-пастка: людина його не бачить, заповнюють лише боти.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  turnstileToken?: string;
}

export class UpdateMessageDto {
  @IsEnum(MessageStatus)
  status!: MessageStatus;
}

export class MessagesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;
}
