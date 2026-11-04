import type { MetadataRoute } from "next";

/**
 * Crawling stays closed until the DNS cutover: the same pages are live on the
 * old site, and duplicates hurt its ranking. Cutover flips this (see TODO.md).
 */
const CRAWLING_OPEN = false;

// A safety net, so a stored response cannot outlive the cutover edit.
export const revalidate = 3600;

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", ...(CRAWLING_OPEN ? { allow: "/" } : { disallow: "/" }) } };
}
