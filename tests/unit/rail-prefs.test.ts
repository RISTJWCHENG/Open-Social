import { describe, expect, it } from 'vitest';
import { DEFAULT_RAIL, moveRail, normalizeRail, setShown, visibleRail } from '../../src/core/settings/railPrefs';

describe('rail preferences', () => {
  it('repairs stored values and adds new features', () => {
    const p = normalizeRail({ order: ['market', 'bogus', 'chats'], hidden: ['chats', 'news', 'x'] });
    expect(p.order.slice(0, 2)).toEqual(['market', 'chats']);
    expect(p.order).toHaveLength(DEFAULT_RAIL.order.length);
    expect(p.hidden).toEqual(['news']);
    expect(normalizeRail('junk')).toEqual(DEFAULT_RAIL);
  });

  it('hides, shows and moves items; Chats always stays', () => {
    let p = setShown(DEFAULT_RAIL, 'market', false);
    expect(visibleRail(p)).not.toContain('market');
    p = setShown(p, 'chats', false);
    expect(visibleRail(p)[0]).toBe('chats');
    p = moveRail(p, 'news', -1);
    expect(p.order.indexOf('news')).toBe(1);
    expect(moveRail(p, 'chats', -1)).toBe(p);
    expect(visibleRail(setShown(p, 'market', true))).toContain('market');
  });
});
