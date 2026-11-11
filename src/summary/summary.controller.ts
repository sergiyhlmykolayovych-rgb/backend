import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequestStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;

// Зведення для головної сторінки адмінки й лічильники в меню.
@Controller({
  path: 'admin/summary',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class SummaryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getSummary() {
    const since = new Date(Date.now() - 30 * DAY_MS);

    const [
      newRequests,
      newMessages,
      publishedProjects,
      draftProjects,
      requestsLast30Days,
      latestRequests,
      latestMessages,
      statusGroups,
    ] = await Promise.all([
      this.prisma.projectRequest.count({
        where: { status: RequestStatus.NEW },
      }),
      this.prisma.contactMessage.count({ where: { status: 'NEW' } }),
      this.prisma.project.count({ where: { isPublished: true } }),
      this.prisma.project.count({ where: { isPublished: false } }),
      this.prisma.projectRequest.count({
        where: { createdAt: { gte: since } },
      }),
      this.prisma.projectRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          phone: true,
          buildingType: true,
          reference: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          phone: true,
          message: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.projectRequest.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    return {
      newRequests,
      newMessages,
      publishedProjects,
      draftProjects,
      requestsLast30Days,
      requestsByStatus: statusGroups.map((group) => ({
        status: group.status,
        count: group._count._all,
      })),
      latestRequests,
      latestMessages,
    };
  }
}
