// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePlayer, fewerBars } from '../../src/ui/voice/VoicePlayer';

const voice = { ms: 75_000, wave: btoa(String.fromCharCode(...Array.from({ length: 48 }, (_, i) => (i * 37) % 256))) };

describe('Voice message player', () => {
  it('shows play, the waveform, the length and a speed control', async () => {
    const { container } = render(<VoicePlayer voice={voice} src="blob:voice" />);
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeEnabled();
    expect(container.querySelectorAll('.voice-wave span')).toHaveLength(30);
    expect(screen.getByText('1:15')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Playback speed 1×' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '1.5×' }));
    expect(screen.getByRole('button', { name: 'Playback speed 1.5×' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Playback speed 1.5×' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '2×' }));
    expect(screen.getByRole('button', { name: 'Playback speed 2×' })).toBeInTheDocument();
  });

  it('draws the loudest value of each part', () => {
    expect(fewerBars([1, 5, 2, 8, 3, 4], 3)).toEqual([5, 8, 4]);
    expect(fewerBars([1, 2], 3)).toEqual([1, 2]);
  });

  it('cannot play until the audio is on this device, and shows the transfer status', () => {
    render(<VoicePlayer voice={voice} src={null} status="Receiving… 40%" />);
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeDisabled();
    expect(screen.getByText('Receiving… 40%')).toBeInTheDocument();
  });
});
