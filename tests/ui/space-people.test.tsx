// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpacePeople } from '../../src/ui/space/SpacePeople';

const ME = 'aaaaa-bbbbb-ccc';
const friends = [
  { account: 'ddddd-eeeee-fff', name: 'Zoe', username: 'zoe' },
  { account: 'ggggg-hhhhh-iii', name: 'Alice' },
];

describe('Space people column', () => {
  it('lists you first, then friends by name, and filters them', () => {
    const onOpenSpace = vi.fn();
    render(
      <SpacePeople
        me={ME}
        myPerson={{ name: 'Unbreakable' }}
        friends={friends}
        openOwner={ME}
        profiles={null}
        onOpenSpace={onOpenSpace}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.querySelector('strong')?.textContent);
    expect(names).toEqual(['Unbreakable', 'Alice', 'Zoe']);
    expect(screen.getByRole('button', { name: /Unbreakable/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.change(screen.getByPlaceholderText('Search names, @username or ID'), { target: { value: '@zo' } });
    expect(screen.queryByText('Alice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Zoe/ }));
    expect(onOpenSpace).toHaveBeenCalledWith('ddddd-eeeee-fff');
  });
});
