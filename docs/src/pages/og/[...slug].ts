import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

const entries = await getCollection('docs');
const pages = Object.fromEntries(
  entries.map(({ id, data }) => [id, data]),
);

export const { getStaticPaths, GET } = await OGImageRoute({
  param: 'slug',
  pages,
  getImageOptions(path, page) {
    const isHome = path === 'index';

    return {
      title: isHome ? 'whereto.bike' : page.title,
      description: isHome
        ? 'Know where to ride.'
        : page.description,
      logo: {
        path: './public/bicycle.png',
        size: [80],
      },
      bgGradient: [[24, 24, 40], [44, 52, 80]],
      ...(isHome && {
        bgImage: {
          path: './public/hero-screenshot.webp',
          fit: 'contain' as const,
          position: 'end' as const,
        },
      }),
      border: {
        color: [255, 165, 0],
        width: 10,
        side: 'block-end' as const,
      },
      font: {
        title: {
          color: [255, 255, 255],
          size: isHome ? 64 : 56,
          weight: 'Bold',
        },
        description: {
          color: [200, 200, 220],
          size: 32,
        },
      },
      fonts: [
        'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-normal.ttf',
        'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-700-normal.ttf',
      ],
      padding: 60,
    };
  },
});
