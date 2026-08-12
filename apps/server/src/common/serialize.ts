import { plainToInstance, type ClassConstructor } from 'class-transformer';

/**
 * Convert a plain object (e.g. Prisma result) to a DTO instance,
 * stripping any fields not decorated with @Expose().
 *
 * This is the single way to build API responses — services should
 * always return `serialize(DtoClass, data)` instead of hand-mapping.
 */
export function serialize<T>(cls: ClassConstructor<T>, data: object): T {
  return plainToInstance(cls, data, { excludeExtraneousValues: true });
}

/**
 * Array variant — convert an array of plain objects to DTO instances.
 */
export function serializeArray<T>(cls: ClassConstructor<T>, data: object[]): T[] {
  return data.map((item) => plainToInstance(cls, item, { excludeExtraneousValues: true }));
}
