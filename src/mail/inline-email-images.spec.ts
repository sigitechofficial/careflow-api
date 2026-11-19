import { inlineImageSrc, inlineImagesFor } from './inline-email-images';

describe('inline email images', () => {
  it('attaches each bundled image the email refers to, once', () => {
    const html = `<img src="${inlineImageSrc('careflow-app-store-badge')}"><img src="cid:careflow-google-play-badge"><img src="cid:careflow-app-store-badge">`;
    const imgs = inlineImagesFor(html);
    expect(imgs.map((i) => i.contentId).sort()).toEqual(['careflow-app-store-badge', 'careflow-google-play-badge']);
    expect(imgs[0]!.content.subarray(1, 4).toString()).toBe('PNG');
  });

  it('ignores unknown ids and emails without images', () => {
    expect(inlineImagesFor('<img src="cid:something-else">')).toEqual([]);
    expect(inlineImagesFor(undefined)).toEqual([]);
  });
});
