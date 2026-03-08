import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const isStaging = process.env.DOCS_ENV === 'staging';

export default defineConfig({
  site: 'https://whereto.bike',
  integrations: [
    starlight({
      title: 'whereto.bike',
      logo: {
        src: './public/bicycle.png',
        alt: 'whereto.bike',
      },
      description: 'A cycling wiki built by communities who ride.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/eljojo/bike-app-astro' },
      ],
      head: [
        // Block search engine indexing on staging
        ...(isStaging ? [{
          tag: 'meta',
          attrs: { name: 'robots', content: 'noindex, nofollow' },
        }] : []),
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        Head: './src/components/Head.astro',
        Sidebar: './src/components/Sidebar.astro',
      },
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
