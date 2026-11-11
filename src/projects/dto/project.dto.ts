import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '../../common/pagination.js';
import { ProjectCategory } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Скільки фото можна додати до одного проєкту.
export const MAX_PROJECT_IMAGES = 20;

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  // Адреса сторінки. Якщо не задана, будується з назви.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug may contain only lowercase latin letters, digits and dashes',
  })
  slug?: string;

  @IsOptional()
  @IsEnum(ProjectCategory)
  category?: ProjectCategory;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  buildingType!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  area?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  status?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  scope?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  intro?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  concept?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  // Ціна проєкту в гривнях; null прибирає ціну.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price?: number | null;

  // Посилання на Google Диск для великих файлів; порожній рядок прибирає посилання.
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @MaxLength(500)
  @Matches(/^https:\/\/(drive|docs)\.google\.com\//, {
    message: 'fileUrl must be a https link to Google Drive',
  })
  fileUrl?: string;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class ProjectsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ProjectCategory)
  category?: ProjectCategory;

  @IsOptional()
  @IsString()
  published?: 'true' | 'false';
}

export class ReorderIdsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class UpdateImageDto {
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  alt!: string;
}
