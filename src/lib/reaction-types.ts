import { z } from 'zod';

export const VALID_CONTENT_TYPES = ['route', 'event'] as const;
export const VALID_REACTION_TYPES = ['ridden', 'thumbs-up', 'star'] as const;

export const reactionSchema = z.object({
  contentType: z.enum(VALID_CONTENT_TYPES),
  contentSlug: z.string().min(1).max(200),
  reactionType: z.enum(VALID_REACTION_TYPES),
});
