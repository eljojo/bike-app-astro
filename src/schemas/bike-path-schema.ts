import { z } from 'zod/v4';

// NOTE: name_{locale} keys (e.g. name_fr, name_nl) are stored in frontmatter
// for secondary locale names. The catchall allows these through without hardcoding
// specific locales. The typed name_fr field remains for backward compatibility
// with existing content but new code should use the dynamic name_{locale} pattern.
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
  /** Wikipedia article reference — "en:Article Title" or "fr:Titre". Overrides YML value. */
  wikipedia: z.string().optional(),
  /** Operator override — overrides the operator from bikepaths.yml. */
  operator: z.string().optional(),
}).catchall(z.unknown());
