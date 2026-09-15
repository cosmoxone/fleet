import { zRecipeDto } from '@aaif/goose-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';

type JsonSchema = Record<string, unknown>;

const recipeDescription =
  'A Recipe represents a reusable agent configuration with instructions, optional prompt, parameters, supported extensions, settings, and subrecipes.';

let recipeJsonSchema: JsonSchema | null = null;

export function getRecipeJsonSchema(): JsonSchema {
  if (!recipeJsonSchema) {
    recipeJsonSchema = {
      // Widen to ZodType: passing the full ZodObject union into the generic
      // parameter trips TS2589 (excessive instantiation depth) in CI tooling.
      ...(zodToJsonSchema(zRecipeDto as unknown as ZodType, { $refStrategy: 'none' }) as JsonSchema),
      title: 'Recipe',
      description: recipeDescription,
    };
  }

  return recipeJsonSchema;
}
