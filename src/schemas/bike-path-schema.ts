import { z } from 'astro/zod';

export const bikePathSchema = z.object({
  name: z.string().optional(),
  name_fr: z.string().optional(),
  vibe: z.string().optional(),
  hidden: z.boolean().default(false),
  stub: z.boolean().default(false),
  featured: z.boolean().default(false),
  includes: z.array(z.string()).default([]),
  photo_key: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
