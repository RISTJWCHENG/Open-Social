// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LinkIcon } from '../../src/ui/LinkIcon';

describe('LinkIcon', () => {
  it('shows the built-in logo of a known service once the logos load', async () => {
    const { container } = render(<LinkIcon url="https://github.com/someone" />);
    await waitFor(() => expect(container.querySelector('.link-icon.is-web')).toBeNull());
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M12/);
  });

  it('shows the web icon for any other website and never loads an image', async () => {
    const { container } = render(<LinkIcon url="https://example.com" />);
    await waitFor(() => expect(container.querySelector('.link-icon.is-web')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
  });
});
