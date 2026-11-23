import type { MetadataRoute } from 'next';

import { resolveSiteUrl } from '@/lib/site-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl();
  return [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
    },
  ];
}
