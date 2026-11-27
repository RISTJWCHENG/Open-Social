// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RAIL, RAIL_IDS } from '../../src/core/settings/railPrefs';
import { RailPreferences } from '../../src/ui/RailPreferences';

const items = RAIL_IDS.map((id) => ({ id, label: id, icon: null, available: id !== 'ideas' }));

describe('RailPreferences', () => {
  it('toggles and moves sidebar items', () => {
    const onChange = vi.fn();
    render(<RailPreferences prefs={DEFAULT_RAIL} items={items} onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Show chats in the sidebar' })).toBeDisabled();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Show market in the sidebar' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: ['market'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Move market up' }));
    const order = onChange.mock.lastCall![0].order as string[];
    expect(order.indexOf('market')).toBe(RAIL_IDS.indexOf('market') - 1);
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
  });
});
