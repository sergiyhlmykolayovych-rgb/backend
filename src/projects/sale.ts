import type { Prisma } from '../generated/prisma/client.js';

// Проєкт можна купити, коли він опублікований, має ціну й що віддати покупцю:
// завантажений PDF або посилання на Google Диск.
export const SELLABLE_WHERE = {
  isPublished: true,
  price: { not: null },
  OR: [{ fileKey: { not: null } }, { fileUrl: { not: null } }],
} satisfies Prisma.ProjectWhereInput;

export const isForSale = (project: {
  isPublished: boolean;
  price: unknown;
  fileKey: string | null;
  fileUrl: string | null;
}) =>
  project.isPublished &&
  project.price !== null &&
  project.price !== undefined &&
  Boolean(project.fileKey || project.fileUrl);
