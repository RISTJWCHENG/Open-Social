// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventsPanel } from '../../src/ui/events/EventsPanel';
import { EventEditor } from '../../src/ui/events/EventEditor';
import { EventDetail } from '../../src/ui/events/EventDetail';
import { EventCard } from '../../src/ui/events/EventCard';
import type { ZEvent } from '../../src/core/events/events';

const ME = 'me';
const tomorrow = Date.now() + 86_400_000;
const ev = (over: Partial<ZEvent> = {}): ZEvent => ({
  id: '0123456789abcdef',
  organizer: 'alice',
  title: 'Launch party',
  start: tomorrow,
  location: 'Portland',
  invitees: [ME, 'bob'],
  responses: { bob: 'going' },
  updatedAt: 1,
  ...over,
});
const people = (a: string) => ({ name: a === ME ? 'You' : a[0]!.toUpperCase() + a.slice(1) });

describe('Event views', () => {
  it('the panel lists upcoming events and invites, and starts a new event', () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(<EventsPanel events={[ev()]} me={ME} selectedId={null} onSelect={onSelect} onNew={onNew} />);
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Invites/ }));
    fireEvent.click(screen.getByRole('button', { name: /Launch party/ }));
    expect(onSelect).toHaveBeenCalledWith('0123456789abcdef');
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('the editor checks the times and saves the invite list', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <EventEditor
        friends={[{ account: 'bob', name: 'Bob' }]}
        reminder={15}
        day="2030-05-04"
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. Launch party'), { target: { value: 'Dinner' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const [input, reminder] = onSave.mock.calls[0] as unknown as [
      { title: string; invitees: string[]; start: number },
      number,
    ];
    expect(input).toMatchObject({ title: 'Dinner', invitees: ['bob'] });
    expect(new Date(input.start).getDate()).toBe(4);
    expect(reminder).toBe(15);
  });

  it('the detail lets an invitee reply and shows the guests', () => {
    const onRespond = vi.fn(async () => undefined);
    render(
      <EventDetail
        event={ev()}
        me={ME}
        people={people}
        reminder={15}
        onReminder={() => undefined}
        onRespond={onRespond}
        onEdit={() => undefined}
        onCancelEvent={async () => undefined}
        onDelete={async () => undefined}
        onOpenChat={() => undefined}
        onBack={() => undefined}
        onNew={() => undefined}
      />,
    );
    expect(screen.getByText("1 going · 0 maybe · 0 can't go · 1 not answered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(onRespond).toHaveBeenCalledWith('maybe');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('the chat card shows the event and quick replies', () => {
    const onRespond = vi.fn();
    render(<EventCard event={ev()} me={ME} onRespond={onRespond} onOpen={() => undefined} />);
    expect(screen.getByText('Launch party')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    expect(onRespond).toHaveBeenCalledWith('going');
  });
});

describe('EventEditor defaults', () => {
  it('a late-evening start ends the next day, so the form can be saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 4, 4, 22, 30));
    try {
      const onSave = vi.fn(async () => undefined);
      render(<EventEditor friends={[]} reminder={15} day="2030-05-10" onSave={onSave} onCancel={() => undefined} />);
      fireEvent.change(screen.getByPlaceholderText('e.g. Launch party'), { target: { value: 'Late show' } });
      fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
      await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
      const [input] = onSave.mock.calls[0] as unknown as [{ start: number; end: number }];
      expect(new Date(input.start).getHours()).toBe(23);
      expect(input.end - input.start).toBe(3_600_000);
      expect(new Date(input.end).getDate()).toBe(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
