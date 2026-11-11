import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';

import {
  AdminProjectsController,
  PublicProjectsController,
} from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [StorageModule],
  controllers: [PublicProjectsController, AdminProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
