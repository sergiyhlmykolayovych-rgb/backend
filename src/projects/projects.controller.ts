import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  MAX_PROJECT_FILE_SIZE,
  MAX_UPLOAD_SIZE,
  type UploadedFileData,
} from '../common/uploads.js';

import {
  CreateProjectDto,
  ProjectsQueryDto,
  ReorderIdsDto,
  UpdateImageDto,
  UpdateProjectDto,
} from './dto/project.dto.js';
import { ProjectsService } from './projects.service.js';

// Відкрита частина: портфоліо на сайті.
@Controller({
  path: 'public/projects',
  version: '1',
})
export class PublicProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findPublished() {
    return this.projectsService.findPublished();
  }

  @Get('images/:imageId')
  // Фото не змінюється (заміна — це нове фото з новим id), тому кешуємо надовго.
  @Header('Cache-Control', 'public, max-age=86400')
  async getImage(@Param('imageId', ParseUUIDPipe) imageId: string) {
    const image = await this.projectsService.getImage(imageId);

    return new StreamableFile(image.stream, { type: image.mimeType });
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.projectsService.findPublishedBySlug(slug);
  }
}

// Керування портфоліо з адмінки.
@Controller({
  path: 'admin/projects',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll(@Query() query: ProjectsQueryDto) {
    return this.projectsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  // Має стояти вище за ':id', інакше «order» сприймався б як ідентифікатор.
  @Put('order')
  reorder(@Body() dto: ReorderIdsDto) {
    return this.projectsService.reorder(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.remove(id);
  }

  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
    }),
  )
  addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileData | undefined,
  ) {
    return this.projectsService.addImage(id, file);
  }

  // Продаж: PDF для покупця (закрите сховище, не плутати з публічними фото)
  @Post(':id/file')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PROJECT_FILE_SIZE, files: 1 },
    }),
  )
  setFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileData | undefined,
  ) {
    return this.projectsService.setFile(id, file);
  }

  @Delete(':id/file')
  removeFile(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.removeFile(id);
  }

  @Get(':id/file')
  async getFile(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.projectsService.getFile(id);

    return new StreamableFile(file.stream, {
      type: 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Put(':id/images/order')
  reorderImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderIdsDto,
  ) {
    return this.projectsService.reorderImages(id, dto);
  }

  @Patch(':id/images/:imageId')
  updateImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ) {
    return this.projectsService.updateImage(id, imageId, dto);
  }

  @Delete(':id/images/:imageId')
  removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.projectsService.removeImage(id, imageId);
  }
}
