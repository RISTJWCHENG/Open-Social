// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerifyEmailDialog } from '../../src/ui/VerifyEmailDialog';

describe('VerifyEmailDialog', () => {
  it('confirms the emailed code, shows errors, resends and skips', async () => {
    const onVerify = vi.fn().mockRejectedValueOnce(new Error('Wrong code. 4 tries left.')).mockResolvedValueOnce(undefined);
    const onResend = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn();
    render(<VerifyEmailDialog sentTo="e***@example.com" onVerify={onVerify} onResend={onResend} onSkip={onSkip} />);
    expect(screen.getByText('e***@example.com')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Code from the email'), '12ab3456');
    expect(screen.getByLabelText('Code from the email')).toHaveValue('123456');
    await userEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong code');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onVerify).toHaveBeenLastCalledWith('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(onResend).toHaveBeenCalled();
    expect(await screen.findByText('A new code is on its way.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalled();
  });
});
