import { beforeAll, describe, expect, it } from 'vitest';
import { glyphOn, linkPlatform, linkPlatformsReady, loadLinkPlatforms } from '../../src/core/profile/linkPlatform';
import { LINK_SERVICES } from '../../src/core/profile/linkServices';

describe('link platform', () => {
  beforeAll(() => loadLinkPlatforms());

  it('is ready once the built-in logos are loaded', () => {
    expect(linkPlatformsReady()).toBe(true);
  });

  it('recognises services by host, with or without www and subdomains', () => {
    expect(linkPlatform('https://www.facebook.com/someone')?.name).toBe('Facebook');
    expect(linkPlatform('https://instagram.com/someone')?.name).toBe('Instagram');
    expect(linkPlatform('https://t.me/someone')?.name).toBe('Telegram');
    expect(linkPlatform('https://discord.gg/abc')?.name).toBe('Discord');
    expect(linkPlatform('https://twitter.com/someone')?.name).toBe('X');
    expect(linkPlatform('https://someone.substack.com')?.name).toBe('Substack');
    expect(linkPlatform('https://paypal.me/someone')?.name).toBe('PayPal');
    expect(linkPlatform('https://internetcomputer.org')?.name).toBe('Internet Computer');
  });

  it('prefers the most specific host', () => {
    expect(linkPlatform('https://music.youtube.com/channel/x')?.name).toBe('YouTube Music');
    expect(linkPlatform('https://www.youtube.com/@x')?.name).toBe('YouTube');
    expect(linkPlatform('https://music.apple.com/album/x')?.name).toBe('Apple Music');
  });

  it('treats any other address as a plain website', () => {
    expect(linkPlatform('https://example.com')).toBeNull();
    expect(linkPlatform('https://notfacebook.com')).toBeNull();
    expect(linkPlatform('not a url')).toBeNull();
  });

  it('lists every host once, as a bare lower-case host name', () => {
    const hosts = LINK_SERVICES.flatMap(([, h]) => h);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const host of hosts) expect(host).toMatch(/^([a-z0-9-]+\.)+[a-z]{2,}$/);
  });

  it('puts a dark logo on light brand colours', () => {
    expect(glyphOn('#FFFC00')).toBe('#000000');
    expect(glyphOn('#0866FF')).toBe('#ffffff');
  });
});
