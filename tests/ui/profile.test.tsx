// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileCard } from '../../src/ui/ProfileCard';
import { DeleteAccountCard } from '../../src/ui/DeleteAccountCard';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { validateProfile, emptyProfile } from '../../src/core/profile/profile';
import { normalizeProfile, openProfile, sealProfile, newProfileKey } from '../../src/core/profile/sealedProfile';

describe('Profile settings', () => {
  const page = (onSave = vi.fn().mockResolvedValue(undefined), value: Parameters<typeof ProfileCard>[0]['value'] = null) =>
    render(<ProfileCard value={value} ready fallbackName="ibfma…rae" onSave={onSave} />);

  it('fills a link name from a known service, but keeps a name the user typed', async () => {
    page();
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    const address = screen.getByLabelText('Link 1 address');
    const name = screen.getByLabelText('Link 1 name');
    expect(screen.queryByText('Add a name for this link.')).toBeNull(); // a fresh row is not an error yet
    await userEvent.clear(address);
    await userEvent.type(address, 'https://instagram.com/example');
    expect(name).toHaveValue('Instagram');
    await userEvent.clear(address);
    await userEvent.type(address, 'https://t.me/example');
    expect(name).toHaveValue('Telegram');
    await userEvent.clear(address);
    await userEvent.type(address, 'https://example.com');
    expect(name).toHaveValue(''); // unknown site: the user names it
    expect(screen.getByText('Add a name for this link.')).toBeInTheDocument();
    await userEvent.type(name, 'My site');
    await userEvent.clear(address);
    await userEvent.type(address, 'https://t.me/example');
    expect(name).toHaveValue('My site');
  });

  it('saves name, username, bio and links through onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    page(onSave);
    expect(screen.getByPlaceholderText('ibfma…rae')).toBeInTheDocument(); // display name is optional
    await userEvent.type(screen.getByPlaceholderText('ibfma…rae'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Username'), 'Ada L');
    expect(screen.getByLabelText('Username')).toHaveValue('AdaL');
    await userEvent.type(screen.getByPlaceholderText('A short line about you'), 'Hello');
    expect(screen.getByText('5/160')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Link 1 name'), 'Studio');
    expect(screen.getByLabelText('Link 1 address')).toHaveValue('https://'); // starts with the scheme
    await userEvent.clear(screen.getByLabelText('Link 1 address'));
    await userEvent.type(screen.getByLabelText('Link 1 address'), 'studio.example');
    expect(screen.getByText('Use a full https:// address.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Link 1 address'));
    await userEvent.type(screen.getByLabelText('Link 1 address'), 'https://studio.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      visibility: 'friends',
      profile: {
        displayName: 'Ada Lovelace',
        username: 'AdaL',
        bio: 'Hello',
        links: [{ label: 'Studio', url: 'https://studio.example' }],
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved');
  });

  it('edits the cover in the same place and size as the profile panel shows it', async () => {
    const cover = 'data:image/webp;base64,UklGRg==';
    const { container } = page(undefined, { profile: { ...emptyProfile(), cover }, visibility: 'friends' });
    const hero = container.querySelector('.pf-cover') as HTMLElement;
    expect(hero.classList.contains('cover')).toBe(true); // shares the panel's .cover styles
    expect(hero.style.backgroundImage).toContain(cover);
    expect(container.querySelector('.pf-cover .profile-avatar')).not.toBeNull(); // and its avatar placement
    await userEvent.click(screen.getByRole('button', { name: 'Remove cover image' }));
    expect((container.querySelector('.pf-cover') as HTMLElement).style.backgroundImage).toBe('');
    expect(screen.getByRole('button', { name: 'Add cover image' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cover image')).toHaveAttribute('accept', 'image/*');
  });

  it('removes links and shows save errors, keeping the changes', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('That username is taken'));
    page(onSave, {
      profile: { ...emptyProfile(), displayName: 'A', links: [{ label: 'Site', url: 'https://a.example' }] },
      visibility: 'public',
    });
    expect(screen.getByText(/Your profile is public/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove link 1' }));
    expect(screen.queryByLabelText('Link 1 name')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('status')).toHaveTextContent('That username is taken');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('fills in a profile that loads after editing began, keeping the user\'s changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = { ready: true, fallbackName: 'x', onSave };
    const { rerender } = render(<ProfileCard value={null} {...props} />);
    await userEvent.type(screen.getByLabelText(/bio/i), 'hello');
    const loaded = { ...emptyProfile(), displayName: 'Ada', username: 'ada', bio: 'old' };
    rerender(<ProfileCard value={{ profile: loaded, visibility: 'public' }} {...props} />);
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Ada');
    expect(screen.getByLabelText(/bio/i)).toHaveValue('hello');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].profile).toMatchObject({ displayName: 'Ada', username: 'ada', bio: 'hello' });
  });

  it('allows up to 10 links, then hides + Add link', async () => {
    page();
    for (let i = 0; i < 10; i++) await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    expect(screen.getByLabelText('Link 10 address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add link' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /Remove link/i })[0]!);
    expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument();
  });

  it('opens a profile saved before links existed (no blank page)', () => {
    const old = { profile: { displayName: 'R', username: 'r', bio: '', avatar: '', updatedAt: 1 }, visibility: 'friends' };
    page(undefined, old as never);
    expect(screen.getByRole('button', { name: '+ Add link' })).toBeInTheDocument();
    expect(normalizeProfile({ displayName: 'R' }).links).toEqual([]);
    expect(normalizeProfile(null)).toMatchObject({ displayName: '', links: [], avatar: '', cover: '' });
  });

  it('checks limits', () => {
    expect(validateProfile({ ...emptyProfile(), displayName: 'x'.repeat(41) }).displayName).toBeTruthy();
    expect(validateProfile({ ...emptyProfile(), username: 'p\u0430ypal' }).username).toBeTruthy();
    expect(validateProfile({ ...emptyProfile(), bio: 'x'.repeat(161) }).bio).toBeTruthy();
    expect(validateProfile({ ...emptyProfile(), links: [{ label: 'x', url: 'javascript:alert(1)' }] }).link?.[0]).toBeTruthy();
    expect(validateProfile(emptyProfile())).toEqual({});
  });

  it('keeps a known presence status and falls back to available', () => {
    expect(normalizeProfile({ status: 'dnd' }).status).toBe('dnd');
    expect(normalizeProfile({ status: 'invisible' }).status).toBe('available');
    expect(normalizeProfile({}).status).toBe('available');
  });

  it('seals profiles so only the key holder can read them', async () => {
    const key = newProfileKey();
    const p = { displayName: 'Ada', username: 'ada', bio: 'hi', location: 'Portland, Oregon', birthDate: '2000-01-15', avatar: '', cover: 'data:image/webp;base64,UklGRg==', links: [{ label: 'Site', url: 'https://example.com/me' }], status: 'busy' as const, updatedAt: 3 };
    const blob = await sealProfile(p, key);
    expect(new TextDecoder().decode(blob)).not.toContain('Portland');
    expect(await openProfile(blob, key)).toEqual(p);
    await expect(openProfile(blob, newProfileKey())).rejects.toThrow();
  });
});

describe('Delete account', () => {
  it('only deletes after typing DELETE, and reports errors', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Network down'));
    render(<DeleteAccountCard onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account…' }));
    const go = screen.getByRole('button', { name: 'Delete everything' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(go).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type DELETE to confirm'));
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(go);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});

describe('Error boundary', () => {
  it('shows an error with Reload instead of a blank page', () => {
    const Boom = () => {
      throw new Error('boom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('Large video attachments', () => {
  it('show a preview frame with a play button and play in the chat', async () => {
    const { AttachmentView } = await import('../../src/ui/AttachmentView');
    const a = {
      fileId: 'f'.repeat(24),
      name: 'final_film_share.mp4',
      mime: 'video/mp4',
      size: 167_700_000,
      via: 'p2p' as const,
      state: 'ready' as const,
      done: 1,
      total: 1,
      localChunks: 40,
      thumb: 'data:image/webp;base64,UklGRg==',
    };
    const openBlob = vi.fn(async (p: (f: number) => void) => {
      p(0.5);
      return new Blob([new Uint8Array(10)], { type: 'video/mp4' });
    });
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:video';
    const { container } = render(
      <AttachmentView a={a} load={async () => null} save={async () => {}} openBlob={openBlob} />,
    );
    expect(container.querySelector('.att-video-tile img')).toHaveAttribute('src', a.thumb);
    await userEvent.click(screen.getByRole('button', { name: 'Play final_film_share.mp4' }));
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video'));
    expect(openBlob).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save final_film_share.mp4' })).toBeInTheDocument();
  });

  it('while the profile is coming from another device, offers to save it here as a new profile', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onStartNew = vi.fn();
    const value = { profile: { ...emptyProfile(), displayName: 'Ada', username: 'ada' }, visibility: 'public' as const };
    render(<ProfileCard value={value} ready fallbackName="ibfma…rae" onSave={onSave} restoring onStartNew={onStartNew} />);
    await userEvent.type(screen.getByLabelText(/bio/i), 'hello');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'No other device: save as my profile' }));
    expect(onStartNew).toHaveBeenCalled();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});
