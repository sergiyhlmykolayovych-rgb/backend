import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '../../common/pagination.js';
import { RequestStatus } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Значення збігаються з тими, що надсилає форма на сайті.
export const BUILDING_TYPE_CODES = [
  'house',
  'commercial',
  'retail',
  'public',
  'other',
] as const;

export class CreateRequestDto {
  @IsIn(BUILDING_TYPE_CODES)
  buildingType!: (typeof BUILDING_TYPE_CODES)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  area?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  stage?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  scope?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  budget?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  style?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  floors?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  siteInfo?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  requirements?: string;

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

  // Форма надсилає порожній рядок, коли пошту не вказано.
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== '')
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  message?: string;

  // Назва проєкту-прикладу, з якого прийшов відвідувач.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string;

  // Згода на обробку персональних даних: без неї заявку не приймаємо.
  @Equals(true, { message: 'Потрібна згода на обробку персональних даних' })
  consent!: boolean;

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

export class UpdateRequestDto {
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  // null або порожній рядок очищає нотатку.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  note?: string;
}

export class RequestsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}
