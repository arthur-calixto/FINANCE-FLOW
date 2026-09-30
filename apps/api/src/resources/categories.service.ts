import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateCategory, UpdateCategory } from '@finance-flow/validation';
import { PrismaService } from '../prisma.service';
import { databaseOperation } from './database-errors';
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}
  list(workspaceId: string, includeInactive: boolean) {
    return this.prisma.client.category.findMany({
      where: { workspaceId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async get(workspaceId: string, id: string) {
    const row = await this.prisma.client.category.findFirst({
      where: { workspaceId, id },
    });
    if (!row)
      throw new NotFoundException('Categoria não encontrada neste workspace.');
    return row;
  }
  create(workspaceId: string, data: CreateCategory) {
    return this.save(workspaceId, data);
  }
  update(workspaceId: string, id: string, data: UpdateCategory) {
    return this.save(workspaceId, data, id);
  }
  deactivate(workspaceId: string, id: string) {
    return this.update(workspaceId, id, { isActive: false });
  }
  private save(
    workspaceId: string,
    data: CreateCategory | UpdateCategory,
    id?: string,
  ) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        // Todas as alterações de hierarquia no tenant compartilham este lock.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId}, 0))::text`;
        const existing = id
          ? await tx.category.findFirst({ where: { workspaceId, id } })
          : null;
        if (id && !existing)
          throw new NotFoundException(
            'Categoria não encontrada neste workspace.',
          );
        const type = data.type ?? existing!.type;
        const parentId =
          data.parentId === undefined
            ? (existing?.parentId ?? null)
            : data.parentId;
        const visited = new Set<string>();
        let currentId = parentId;
        while (currentId) {
          if (currentId === id || visited.has(currentId))
            throw new BadRequestException(
              'Uma categoria não pode ser pai de si mesma ou de um de seus ancestrais.',
            );
          visited.add(currentId);
          const parent = await tx.category.findFirst({
            where: { workspaceId, id: currentId },
          });
          if (!parent)
            throw new BadRequestException(
              'A categoria pai deve pertencer a este workspace.',
            );
          if (parent.type !== type)
            throw new BadRequestException(
              'Categoria e categoria pai devem ter o mesmo tipo.',
            );
          currentId = parent.parentId;
        }
        if (
          id &&
          (await tx.category.findFirst({
            where: { workspaceId, parentId: id, type: { not: type } },
          }))
        )
          throw new BadRequestException(
            'Altere ou desvincule as subcategorias antes de mudar o tipo.',
          );
        if (
          id &&
          data.type &&
          data.type !== existing?.type &&
          (await tx.transaction.findFirst({
            where: { workspaceId, categoryId: id, type: { not: data.type } },
          }))
        )
          throw new BadRequestException(
            'Esta categoria possui lançamentos de outro tipo.',
          );
        if (
          id &&
          data.type &&
          data.type !== existing?.type &&
          ((await tx.recurrence.findFirst({
            where: { workspaceId, categoryId: id, type: { not: data.type } },
          })) ||
            (await tx.recurrenceRevision.findFirst({
              where: {
                workspaceId,
                categoryId: id,
                recurrence: { type: { not: data.type } },
              },
            })))
        )
          throw new BadRequestException(
            'Esta categoria possui recorrências de outro tipo.',
          );
        return id
          ? tx.category.update({
              where: { workspaceId_id: { workspaceId, id } },
              data,
            })
          : tx.category.create({
              data: { ...data, workspaceId, name: data.name!, type },
            });
      }),
    );
  }
}
