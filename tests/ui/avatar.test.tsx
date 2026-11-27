// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar, avatarGradient, initial } from '../../src/ui/Avatar';

describe('Avatar', () => {
  it('uses one letter of the name, in any script', () => {
    expect(initial('rist cheng')).toBe('R');
    expect(initial('王小明')).toBe('王');
    expect(initial('@alice')).toBe('A');
    expect(initial('  ')).toBe('?');
  });

  it('gives the same person the same gradient, and different people different ones', () => {
    expect(avatarGradient('aaaaa-aa')).toBe(avatarGradient('aaaaa-aa'));
    expect(avatarGradient('aaaaa-aa')).not.toBe(avatarGradient('bbbbb-bb'));
    expect(avatarGradient('x')).toMatch(/^linear-gradient\(135deg, hsl\(/);
  });

  it('draws a white letter on a gradient when there is no photo', () => {
    const { container } = render(<Avatar name="Eve" className="avatar-40" seed="acct-1" />);
    const el = container.querySelector('.avatar') as HTMLElement;
    expect(el.textContent).toBe('E');
    expect(el.style.color).toBe('rgb(255, 255, 255)');
    expect(el.style.background).toContain('linear-gradient');
  });

  it('shows the photo when there is one', () => {
    const { container } = render(<Avatar name="Eve" className="avatar-40" src="data:image/png;base64,AA==" />);
    expect(container.querySelector('img')).not.toBeNull();
  });
});
