// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatSettingsMenu } from '../../src/ui/ChatSettingsMenu';
import { chatThemeStyle } from '../../src/ui/chatThemes';

function setup(theme?: string) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const props = { onTheme: vi.fn(), onTextSize: vi.fn(), onInfo: vi.fn(), onClose: vi.fn() };
  render(<ChatSettingsMenu anchor={anchor} theme={theme} textSize="default" {...props} />);
  return props;
}

describe('Chat settings menu', () => {
  it('shows the current theme and text size, and opens contact info', async () => {
    const p = setup('mint');
    expect(screen.getByRole('menuitem', { name: /Chat theme/ })).toHaveTextContent('Mint');
    expect(screen.getByRole('menuitem', { name: /Text size/ })).toHaveTextContent('Default');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Contact info' }));
    expect(p.onInfo).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('picks a theme from the previews', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('menuitem', { name: /Chat theme/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Rose' }));
    expect(p.onTheme).toHaveBeenCalledWith('rose');
  });

  it('picks a text size', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('menuitem', { name: /Text size/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
    expect(p.onTextSize).toHaveBeenCalledWith('large');
  });

  it('themes set the chat colours; the default sets none', () => {
    expect(chatThemeStyle(undefined)).toBeUndefined();
    expect(chatThemeStyle('sky')).toMatchObject({ '--bubble-out': '#2f6fb7' });
  });
});
