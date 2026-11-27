// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoTip } from '../../src/ui/InfoTip';

describe('InfoTip', () => {
  it('describes its button, opens on tap and closes on Escape or a tap elsewhere', () => {
    render(
      <div>
        <InfoTip label="What is an OpenSocial ID?">An address.</InfoTip>
        <p>outside</p>
      </div>,
    );
    const btn = screen.getByRole('button', { name: 'What is an OpenSocial ID?' });
    expect(btn).toHaveAccessibleDescription('An address.');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
