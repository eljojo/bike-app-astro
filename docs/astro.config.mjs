import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://whereto.bike',
  integrations: [
    starlight({
      title: 'whereto.bike',
      description: 'A cycling guide built by communities who ride.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/eljojo/bike-app-astro' },
      ],
      sidebar: [
        {
          label: 'About',
          items: [
            { label: 'What is whereto.bike?', slug: 'about/what-is-whereto-bike' },
            { label: 'How it works', slug: 'about/how-it-works' },
            { label: 'Licensing', slug: 'about/licensing' },
            { label: 'Bring it to your city', slug: 'about/bring-to-your-city' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Getting started', slug: 'guides/getting-started' },
            { label: 'Adding routes', slug: 'guides/adding-routes' },
            { label: 'Managing media', slug: 'guides/managing-media' },
            { label: 'Managing events', slug: 'guides/managing-events' },
            { label: 'Editing content', slug: 'guides/editing-content' },
            { label: 'Moderation', slug: 'guides/moderation' },
          ],
        },
      ],
    }),
  ],
});
