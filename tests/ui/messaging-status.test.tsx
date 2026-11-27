// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessagingStatus } from '../../src/ui/MessagingStatus';

describe('MessagingStatus', () => {
  it('shows nothing once messaging runs, or when signed out', () => {
    const { container, rerender } = render(<MessagingStatus ready available error={null} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MessagingStatus ready={false} available={false} error={null} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is starting while there is no error', () => {
    render(<MessagingStatus ready={false} available error={null} onRetry={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Starting secure messaging');
  });

  it('explains a failed start and retries on request', () => {
    const onRetry = vi.fn();
    render(<MessagingStatus ready={false} available error="Too many devices on this account." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too many devices on this account.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
