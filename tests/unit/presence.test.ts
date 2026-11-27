import { describe, expect, it } from 'vitest';
import { presenceLine } from '../../src/core/profile/presence';

describe('presence line', () => {
  it('shows offline whatever the chosen status', () => {
    expect(presenceLine(false, 'busy')).toEqual({ text: 'Offline', tone: 'offline' });
  });

  it('shows online, with the chosen status in brackets unless available', () => {
    expect(presenceLine(true, 'available')).toEqual({ text: 'Online', tone: 'available' });
    expect(presenceLine(true, undefined)).toEqual({ text: 'Online', tone: 'available' });
    expect(presenceLine(true, 'busy')).toEqual({ text: 'Online (Busy)', tone: 'busy' });
    expect(presenceLine(true, 'dnd')).toEqual({ text: 'Online (Do not disturb)', tone: 'dnd' });
    expect(presenceLine(true, 'away')).toEqual({ text: 'Online (Away)', tone: 'away' });
  });
});
