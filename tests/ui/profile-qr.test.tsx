// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inviteLink } from '../../src/ui/inviteLink';

describe('invite link', () => {
  it('opens Add contact with the account ID', () => {
    expect(inviteLink('aaaaa-bbbbb', 'https://chat.opensocial.cc')).toBe('https://chat.opensocial.cc/#add=aaaaa-bbbbb');
  });
});
