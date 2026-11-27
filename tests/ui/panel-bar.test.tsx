// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelBar } from '../../src/ui/PanelBar';
import { ChatToolbar } from '../../src/ui/ChatToolbar';

describe('Right panel bar', () => {
  it('collapses, and switches between profile, highlights and shared', async () => {
    const onView = vi.fn();
    const onCollapse = vi.fn();
    render(<PanelBar view="profile" onView={onView} highlightCount={3} onCollapse={onCollapse} overlay />);
    const views = within(screen.getByRole('tablist', { name: 'Panel' })).getAllByRole('tab');
    expect(views.map((v) => v.getAttribute('aria-label'))).toEqual(['Profile', 'Highlighted messages (3)', 'Media, files and links']);
    expect(views[0]).toHaveAttribute('aria-selected', 'true');
    expect(views[1]).toHaveTextContent('3');
    await userEvent.click(views[2]!);
    expect(onView).toHaveBeenCalledWith('shared');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(onCollapse).toHaveBeenCalled();
  });

  it('without a switcher (your own profile) only collapses', () => {
    render(<PanelBar view="profile" highlightCount={0} onCollapse={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('the chat toolbar offers Expand while the panel is collapsed', async () => {
    const onExpand = vi.fn();
    const search = { open: false, query: '', count: 0, index: 0, onOpen: vi.fn(), onClose: vi.fn(), onQuery: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() };
    render(<ChatToolbar search={search} onExpand={onExpand} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
    expect(onExpand).toHaveBeenCalled();
  });
});
