// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppVersion, releasedOn } from '../../src/ui/AppVersion';

describe('AppVersion', () => {
  it('shows the build version and release date', () => {
    render(<AppVersion />);
    expect(screen.getByText(/^Version \d+\.\d+\.\d+ · Released [A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeInTheDocument();
  });

  it('formats dates like "Nov 14, 2026"', () => {
    expect(releasedOn('2026-11-14T12:00:00Z')).toBe('Nov 14, 2026');
  });
});
