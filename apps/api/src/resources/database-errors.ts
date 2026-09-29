import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
export async function databaseOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025')
        throw new NotFoundException('Registro não encontrado neste workspace.');
      if (error.code === 'P2003')
        throw new BadRequestException(
          'O relacionamento informado não está disponível neste workspace.',
        );
      if (['P2002', 'P2034'].includes(error.code))
        throw new ConflictException(
          'Não foi possível concluir a alteração. Atualize e tente novamente.',
        );
    }
    throw error;
  }
}
