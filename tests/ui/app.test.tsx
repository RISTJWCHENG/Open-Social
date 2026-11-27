// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/ui/App';
import { MOCK_PRINCIPAL, MockAccountProvider } from '../../src/modules/icp-identity';

const signedIn = () =>
  new MockAccountProvider({ principal: MOCK_PRINCIPAL, provider: 'mock' });

/** Mark recovery as already set up so tests start in the chat view. */
const seedRecoverySetup = () =>
  window.localStorage.setItem(
    `opensocial:recovery-setup:${MOCK_PRINCIPAL}`,
    JSON.stringify({ methods: ['recovery-key'], completedAt: 1, skipped: false }),
  );

/** Render the app with a restored (mock) Internet Identity session and wait for it. */
const renderApp = async (provider = signedIn(), seed = true) => {
  if (seed) seedRecoverySetup();
  else window.localStorage.clear();
  const utils = render(<App accountProvider={provider} />);
  if ((await provider.restore()) && seed) await screen.findByRole('main', { name: 'No chat open' });
  return { ...utils, provider };
};


describe('App layout', () => {
  it('starts with no demo contacts: an empty chat list and a way to start a chat', async () => {
    await renderApp();
    const list = screen.getByRole('region', { name: 'Chats' });
    expect(within(list).queryAllByRole('button', { name: /Emily|James|Sophia/ })).toEqual([]);
    expect(screen.queryByText(/Demo contact/)).toBeNull();
    expect(within(list).getByText(/No chats yet/)).toBeInTheDocument();
    const empty = screen.getByRole('main', { name: 'No chat open' });
    expect(within(empty).getByRole('heading', { name: 'No chats yet' })).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    // No contact panel without a chat.
    expect(screen.queryByRole('complementary', { name: 'Contact profile' })).toBeNull();
  });

  it('marks features outside the prototype as unavailable instead of faking them', async () => {
    await renderApp();
    expect(screen.queryByRole('button', { name: /^Calls/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Video calls/ })).toBeDisabled();
    // Contacts opens the address book in the left column.
    await userEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(screen.getByRole('region', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Chats' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Chats/ }));
    expect(screen.getByRole('region', { name: 'Chats' })).toBeInTheDocument();
  });
});

describe('App account menu', () => {
  it('signs out and signs back in', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    // Only the applicable action is offered.
    expect(within(menu).queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    expect(screen.queryByRole('menu')).toBeNull();
    const signedOut = await screen.findByRole('main', { name: 'Signed out' });
    // The sign-in page stands alone: no chat list, sidebar or profile behind it.
    expect(screen.queryByRole('region', { name: 'Chats' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();

    await userEvent.click(within(signedOut).getByRole('button', { name: 'Sign in with Internet Identity' }));
    expect(await screen.findByRole('main', { name: 'No chat open' })).toBeInTheDocument();
  });

  it('opens Settings from the menu; the sidebar has no settings button', async () => {
    await renderApp();
    const rail = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(rail).queryByRole('button', { name: /settings/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const settings = screen.getByRole('complementary', { name: 'Settings' });
    // Settings opens beside the chat, not over it.
    expect(screen.getByRole('main', { name: 'No chat open' })).toBeInTheDocument();
    // Tabs: Profile (default, normal width), Account (wide), Community, Preferences.
    const tabs = within(settings).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Profile', 'Account', 'Community', 'Preferences']);
    expect(within(settings).getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    expect(settings).toHaveAttribute('data-tab', 'profile');
    expect(within(settings).getByRole('form', { name: 'Your profile' })).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('tab', { name: 'Account' }));
    expect(settings).toHaveAttribute('data-tab', 'account');
    expect(within(settings).getByText(MOCK_PRINCIPAL)).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('tab', { name: 'Community' }));
    expect(within(settings).getByText('Who can see your profile')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Contact profile' })).toBeNull();
    await userEvent.click(within(settings).getByRole('button', { name: 'Close settings' }));
    expect(screen.getByRole('main', { name: 'No chat open' })).toBeInTheDocument();
  });

  it('lists Wallet and Diamond as not yet available; My Profile shows the own profile like a contact panel', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    for (const name of [/^Wallet/, /^Diamond/]) {
      const item = within(menu).getByRole('menuitem', { name });
      expect(item).toHaveAttribute('aria-disabled', 'true');
    }
    expect(within(menu).queryByRole('menuitem', { name: 'Profile settings' })).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'My Profile' }));
    // The same panel as for a contact, not an editing page; the chat stays.
    const panel = screen.getByRole('complementary', { name: 'Contact profile' });
    // The long ID isn't under the name; it is in the details below, with a copy button.
    expect(within(panel).getByRole('heading', { name: 'Your OpenSocial ID' })).toBeInTheDocument();
    expect(within(panel).getByText(MOCK_PRINCIPAL)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Copy ID/ })).toBeInTheDocument();
    // The panel collapses (its old close button is now Collapse).
    expect(within(panel).getByRole('button', { name: 'Collapse panel' })).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('main', { name: 'No chat open' })).toBeInTheDocument();
    // Editing lives in Settings (no button for it here).
    expect(within(panel).queryByRole('button', { name: 'Edit in Settings' })).toBeNull();
  });

  it('expands and collapses the sidebar from the bottom button', async () => {
    const { container } = await renderApp();
    const app = container.querySelector('.app')!;
    expect(app).toHaveAttribute('data-rail', 'collapsed');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(app).toHaveAttribute('data-rail', 'expanded');
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(collapse);
    expect(app).toHaveAttribute('data-rail', 'collapsed');
  });

  it('closes the menu with Escape', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Internet Identity sign-in', () => {
  it('starts signed out when there is no session and signs in from the welcome screen', async () => {
    const provider = new MockAccountProvider(null);
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.click(
      within(main).getByRole('button', { name: 'Sign in with Internet Identity' }),
    );
    expect(provider.signInCalls).toBe(1);
    expect(
      await screen.findByRole('main', { name: 'No chat open' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menu', { name: 'Account' })).toHaveTextContent(
      'Signed in with Internet Identity',
    );
    // Home Page opens the OpenSocial Official Website in a new tab.
    const home = screen.getByRole('menuitem', { name: 'Home Page' });
    expect(home).toHaveAttribute('href', 'https://opensocial.cc/');
    expect(home).toHaveAttribute('target', '_blank');
    expect(home).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers only Internet Identity, passkey and email sign-in', async () => {
    await renderApp(new MockAccountProvider(null));
    const main = await screen.findByRole('main', { name: 'Signed out' });
    expect(within(main).queryByRole('button', { name: /Ethereum|Solana|wallet/i })).toBeNull();
  });

  it('shows methods the provider cannot do yet as Soon', async () => {
    await renderApp(new MockAccountProvider(null, ['ii']));
    const main = await screen.findByRole('main', { name: 'Signed out' });
    expect(within(main).getByRole('button', { name: 'Sign in with Internet Identity' })).toBeEnabled();
    expect(within(main).getByRole('button', { name: /Passkey/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(main).queryByRole('button', { name: /new passkey/ })).toBeNull();
    expect(within(main).getByRole('textbox', { name: 'Email' })).toBeDisabled();
  });

  it('signs in with a passkey when the identity service supports it', async () => {
    const provider = new MockAccountProvider(null);
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.click(within(main).getByRole('button', { name: 'Sign in with Passkey' }));
    expect(provider.lastMethod).toBe('passkey');
    expect(
      await screen.findByRole('main', { name: 'No chat open' }),
    ).toBeInTheDocument();
  });

  it('creates a new account from the sign-up page with a new passkey', async () => {
    const provider = new MockAccountProvider(null);
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.click(within(main).getByRole('button', { name: 'Create your OpenSocial account' }));
    expect(screen.queryByRole('main', { name: 'Signed out' })).toBeNull();
    const dialog = screen.getByRole('form', { name: 'Sign up to OpenSocial' });
    const create = within(dialog).getByRole('button', { name: 'Create account' });
    expect(create).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Username/ }), 'New_User');
    expect(within(dialog).getByRole('textbox', { name: /Username/ })).toHaveValue('New_User');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /I agree/ }));
    await userEvent.click(create);
    expect(provider.lastMethod).toBe('passkey-new');
    expect(await screen.findByRole('main', { name: 'No chat open' })).toBeInTheDocument();
  });

  it('signs in with an emailed code', async () => {
    const provider = new MockAccountProvider(null);
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.type(within(main).getByRole('textbox', { name: 'Email' }), 'ada.lovelace@example.com');
    await userEvent.click(within(main).getByRole('button', { name: 'Send sign-in code' }));
    expect(provider.emailsSent).toEqual(['ada.lovelace@example.com']);
    expect(await within(main).findByText(/We sent a 6-digit code to/)).toBeInTheDocument();
    // Other methods are hidden while entering the code.
    expect(within(main).queryByRole('button', { name: /Passkey/ })).toBeNull();

    const codeBox = within(main).getByRole('textbox', { name: 'Code from the email' });
    await userEvent.type(codeBox, '11a1111');
    expect(codeBox).toHaveValue('111111');
    await userEvent.click(within(main).getByRole('button', { name: 'Sign in' }));
    expect(await within(main).findByRole('alert')).toHaveTextContent(/Wrong code/);

    await userEvent.clear(codeBox);
    await userEvent.type(codeBox, provider.emailCode);
    await userEvent.click(within(main).getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('main', { name: 'No chat open' }),
    ).toBeInTheDocument();
    expect(provider.lastMethod).toBe('email');
  });

  it('can go back from the code step to other methods', async () => {
    await renderApp(new MockAccountProvider(null));
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.type(within(main).getByRole('textbox', { name: 'Email' }), 'a@b.co');
    await userEvent.click(within(main).getByRole('button', { name: 'Send sign-in code' }));
    await userEvent.click(await within(main).findByRole('button', { name: 'Use another sign-in method' }));
    expect(within(main).getByRole('button', { name: 'Sign in with Passkey' })).toBeInTheDocument();
  });

  it('shows an error and stays signed out when sign-in is cancelled', async () => {
    const provider = new MockAccountProvider(null);
    provider.failNextSignIn = true;
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.click(
      within(main).getByRole('button', { name: 'Sign in with Internet Identity' }),
    );
    expect(await within(main).findByRole('alert')).toHaveTextContent(/window was closed/);
    expect(screen.getByRole('main', { name: 'Signed out' })).toBeInTheDocument();
  });

  it('lets the user cancel a sign-in that never completes', async () => {
    const provider = new MockAccountProvider(null);
    provider.hangNextSignIn = true;
    await renderApp(provider);
    const main = await screen.findByRole('main', { name: 'Signed out' });
    await userEvent.click(
      within(main).getByRole('button', { name: 'Sign in with Internet Identity' }),
    );
    expect(within(main).getByRole('button', { name: 'Waiting for Internet Identity…' })).toBeDisabled();
    await userEvent.click(within(main).getByRole('button', { name: 'Cancel sign-in' }));
    expect(
      within(main).getByRole('button', { name: 'Sign in with Internet Identity' }),
    ).toBeEnabled();
    await userEvent.click(
      within(main).getByRole('button', { name: 'Sign in with Internet Identity' }),
    );
    expect(
      await screen.findByRole('main', { name: 'No chat open' }),
    ).toBeInTheDocument();
  });

  it('calls the provider sign-out', async () => {
    const { provider } = await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(provider.signOutCalls).toBe(1));
  });
});

describe('First sign-in recovery setup', () => {
  const start = async () => {
    await renderApp(signedIn(), false);
    return screen.findByRole('main', { name: 'Set up account recovery' });
  };

  it('offers the recovery options and explains which are not available yet', async () => {
    const main = await start();
    // Recovery = Internet Identity + any one second factor; no separate zPass layer.
    expect(within(main).queryByText(/First check/)).toBeNull();
    expect(within(main).getByRole('checkbox', { name: /Recovery key/ })).toBeChecked();
    expect(within(main).getByRole('checkbox', { name: /Email/ })).toBeDisabled();
    expect(within(main).getByRole('checkbox', { name: /Phone number/ })).toBeDisabled();
    const kyc = within(main).getByRole('checkbox', { name: /Aleo zPass credential/ });
    expect(kyc).toBeDisabled();
    expect(kyc.closest('label')).toHaveTextContent(/Optional/);
    // OpenSocial is the issuer and checks only account ownership: no ID check.
    expect(kyc.closest('label')).toHaveTextContent(/Not an ID check/);
    expect(kyc.closest('label')).not.toHaveTextContent(/KYC|identity verification partner/);
    expect(within(main).getByRole('checkbox', { name: /Recovery key/ }).closest('label')).toHaveTextContent(
      /24 h wait/,
    );
    expect(within(main).getByRole('checkbox', { name: /Email/ }).closest('label')).toHaveTextContent(
      /72 h wait/,
    );
    expect(screen.queryByRole('complementary', { name: 'Contact profile' })).toBeNull();
  });

  it('requires the recovery key option to continue', async () => {
    const main = await start();
    await userEvent.click(within(main).getByRole('checkbox', { name: /Recovery key/ }));
    expect(within(main).getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows a key, checks two groups and finishes into the chat', async () => {
    const main = await start();
    await userEvent.click(within(main).getByRole('button', { name: 'Continue' }));
    const grid = await within(main).findByRole('list', { name: 'Recovery key' });
    const groups = within(grid)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('code')!.textContent!);
    expect(groups).toHaveLength(9);
    await userEvent.click(within(main).getByRole('checkbox', { name: /saved my recovery key/ }));
    await userEvent.click(within(main).getByRole('button', { name: 'Continue' }));

    const prompt = within(main).getByText(/Type groups \d and \d/).textContent!;
    const [a, b] = prompt.match(/\d/g)!.map(Number);
    const fields = within(main).getAllByRole('textbox');
    await userEvent.type(fields[0]!, 'WRONG');
    await userEvent.type(fields[1]!, 'XXXX');
    await userEvent.click(within(main).getByRole('button', { name: 'Verify' }));
    expect(within(main).getByRole('alert')).toHaveTextContent(/don’t match/);

    await userEvent.clear(fields[0]!);
    await userEvent.clear(fields[1]!);
    await userEvent.type(fields[0]!, groups[a! - 1]!.toLowerCase());
    await userEvent.type(fields[1]!, groups[b! - 1]!);
    await userEvent.click(within(main).getByRole('button', { name: 'Verify' }));
    expect(within(main).getByText('Recovery is set up')).toBeInTheDocument();
    await userEvent.click(within(main).getByRole('button', { name: 'Start chatting' }));

    expect(
      await screen.findByRole('main', { name: 'No chat open' }),
    ).toBeInTheDocument();
    const stored = JSON.parse(
      window.localStorage.getItem(`opensocial:recovery-setup:${MOCK_PRINCIPAL}`)!,
    );
    expect(stored.methods).toEqual(['recovery-key']);
    expect(stored.recoveryKeyCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(groups.join('-'));
  });

  it('can be skipped, then set up, replaced and removed in Settings', async () => {
    const main = await start();
    await userEvent.click(within(main).getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('main', { name: 'No chat open' });

    // A reminder in the chat list leads to Settings.
    const nudge = screen.getByRole('note');
    expect(nudge).toHaveTextContent(/Recovery isn’t set up/);
    await userEvent.click(within(nudge).getByRole('button', { name: 'Set up in Settings' }));
    let settings = screen.getByRole('complementary', { name: 'Settings' });
    expect(within(settings).getByText('First factor: Internet Identity')).toBeInTheDocument();
    expect(within(settings).getByText('Second factor: any one of these')).toBeInTheDocument();
    const factors = within(settings).getByRole('list', { name: 'Second factors' });
    expect(within(factors).getAllByRole('listitem')).toHaveLength(4);
    expect(within(factors).getByText(/Aleo zPass credential/)).toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: 'Remove' })).toBeNull();

    // Create a key.
    await userEvent.click(within(settings).getByRole('button', { name: 'Create recovery key' }));
    const flow = await screen.findByRole('main', { name: 'Create recovery key' });
    const grid = await within(flow).findByRole('list', { name: 'Recovery key' });
    const groups = within(grid)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('code')!.textContent!);
    await userEvent.click(within(flow).getByRole('checkbox', { name: /saved my recovery key/ }));
    await userEvent.click(within(flow).getByRole('button', { name: 'Continue' }));
    const [a, b] = within(flow).getByText(/Type groups \d and \d/).textContent!.match(/\d/g)!.map(Number);
    const fields = within(flow).getAllByRole('textbox');
    await userEvent.type(fields[0]!, groups[a! - 1]!);
    await userEvent.type(fields[1]!, groups[b! - 1]!);
    await userEvent.click(within(flow).getByRole('button', { name: 'Verify' }));
    await userEvent.click(within(flow).getByRole('button', { name: 'Back to settings' }));

    settings = screen.getByRole('complementary', { name: 'Settings' });
    const first = JSON.parse(
      window.localStorage.getItem(`opensocial:recovery-setup:${MOCK_PRINCIPAL}`)!,
    ).recoveryKeyCommitment as string;
    expect(within(settings).getByText(first.slice(0, 16))).toBeInTheDocument();

    // Replace: cancelling keeps the old key.
    await userEvent.click(within(settings).getByRole('button', { name: 'Replace recovery key' }));
    const replace = await screen.findByRole('main', { name: 'Create recovery key' });
    await userEvent.click(within(replace).getByRole('button', { name: 'Cancel' }));
    settings = screen.getByRole('complementary', { name: 'Settings' });
    expect(within(settings).getByText(first.slice(0, 16))).toBeInTheDocument();

    // Remove, with confirmation.
    await userEvent.click(within(settings).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Keep it' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Remove key' }));
    expect(within(settings).getByRole('button', { name: 'Create recovery key' })).toBeInTheDocument();
    const stored = JSON.parse(
      window.localStorage.getItem(`opensocial:recovery-setup:${MOCK_PRINCIPAL}`)!,
    );
    expect(stored.methods).toEqual([]);
    expect(stored.recoveryKeyCommitment).toBeUndefined();
  });
});
