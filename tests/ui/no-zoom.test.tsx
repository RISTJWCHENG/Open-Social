// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useNoZoom } from '../../src/ui/useNoZoom';

function Page() {
  useNoZoom();
  return null;
}

describe('useNoZoom', () => {
  it('locks zoom while the page is shown and restores it afterwards', () => {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    document.head.append(meta);

    const view = render(<Page />);
    expect(meta.content).toContain('user-scalable=no');
    expect(meta.content).toContain('maximum-scale=1');
    expect(document.documentElement).toHaveClass('no-zoom');
    const pinch = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);

    view.unmount();
    expect(meta.content).toBe('width=device-width, initial-scale=1');
    expect(document.documentElement).not.toHaveClass('no-zoom');
    const later = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    meta.remove();
  });
});
