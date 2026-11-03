/**
 * The URL to render for a stored image at roughly `width` px. Identity today,
 * as in production; Cloudflare image transforms plug in here (step 5), so every
 * image on the site goes through this and none through the framework optimizer.
 */
export function image_url(stored_url: string, _width: number): string {
  return stored_url;
}
