import { describe, expect, it } from 'vitest';
import { inAppHash } from '../../src/core/delivery/linkPreview';
import {
  formatBytes,
  itemDraftErrors,
  mediaMime,
  parseTags,
  spaceLink,
  spaceRouteFromHash,
  type ItemDraft,
} from '../../src/core/space/space';

const OWNER = 'tfleu-yvtjb-mpabd-4dscu-4yb3w-75ofh-wq7xg-sochc-6jf4a-o6afc-sae';
const draft = (over: Partial<ItemDraft>): ItemDraft => ({
  kind: 'post',
  title: '',
  body: 'Hello',
  url: '',
  tags: '',
  canisterId: '',
  imageCount: 0,
  hasMedia: false,
  ...over,
});

describe('space', () => {
  it('checks what each kind needs', () => {
    expect(itemDraftErrors(draft({}))).toEqual({});
    expect(itemDraftErrors(draft({ body: '' })).body).toBeTruthy();
    expect(itemDraftErrors(draft({ kind: 'link', url: 'http://x.com' })).url).toContain('https');
    expect(itemDraftErrors(draft({ kind: 'link', url: 'https://x.com' }))).toEqual({});
    expect(Object.keys(itemDraftErrors(draft({ kind: 'work' })))).toEqual(['title', 'imageCount']);
    expect(itemDraftErrors(draft({ kind: 'video', title: 'Clip' })).url).toBeTruthy();
    expect(itemDraftErrors(draft({ kind: 'video', title: 'Clip', hasMedia: true }))).toEqual({});
    expect(
      itemDraftErrors(draft({ kind: 'dapp', title: 'D', url: 'https://d.app', canisterId: 'nope' })).canisterId,
    ).toBeTruthy();
    expect(
      itemDraftErrors(
        draft({ kind: 'dapp', title: 'D', url: 'https://d.app', canisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }),
      ),
    ).toEqual({});
    expect(itemDraftErrors(draft({ tags: 'a b c d e f' })).tags).toBeTruthy();
  });

  it('parses tags, sizes and file types', () => {
    expect(parseTags('#Art, music  art')).toEqual(['art', 'music']);
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(mediaMime('song.mp3', '')).toBe('audio/mpeg');
    expect(mediaMime('clip.mov', '')).toBe('video/mp4');
  });

  it('links to spaces and items', () => {
    expect(spaceLink(OWNER, '3')).toBe(`https://chat.opensocial.cc/#/space/${OWNER}/3`);
    expect(spaceRouteFromHash(`#/space/${OWNER}`)).toEqual({ owner: OWNER });
    expect(spaceRouteFromHash(`#/space/${OWNER}/3`)).toEqual({ owner: OWNER, itemId: '3' });
    expect(spaceRouteFromHash('#/space/bad')).toBeNull();
    expect(inAppHash(spaceLink(OWNER, '3'))).toBe(`#/space/${OWNER}/3`);
  });
});
