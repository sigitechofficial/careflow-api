import { INLINE_EMAIL_IMAGES } from './inline-email-images.generated';

/** `cid:` address for a bundled email image, e.g. src="cid:careflow-app-store-badge". */
export function inlineImageSrc(contentId: keyof typeof INLINE_EMAIL_IMAGES | string): string {
  return `cid:${contentId}`;
}

/** Bundled images an email's HTML refers to (src="cid:…"), ready to attach inline. Unknown ids are ignored. */
export function inlineImagesFor(html: string | undefined): Array<{
  filename: string;
  content: Buffer;
  contentType: string;
  contentId: string;
}> {
  if (!html) return [];
  const ids = new Set<string>();
  for (const m of html.matchAll(/src="cid:([\w.-]+)"/g)) ids.add(m[1]!);
  return [...ids]
    .filter((id) => INLINE_EMAIL_IMAGES[id])
    .map((id) => {
      const img = INLINE_EMAIL_IMAGES[id]!;
      return { filename: img.filename, content: Buffer.from(img.base64, 'base64'), contentType: img.contentType, contentId: id };
    });
}
