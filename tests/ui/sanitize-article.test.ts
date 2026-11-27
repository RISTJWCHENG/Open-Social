// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readingMinutes, sanitizeArticle } from '../../src/ui/sanitizeArticle';

describe('sanitizeArticle', () => {
  it('keeps text markup and drops everything else', () => {
    const out = sanitizeArticle(
      '<p class="x" onclick="evil()" style="color:red">A <strong>b</strong> <span>c</span></p>' +
        '<iframe src="https://e.example"></iframe><img src="x" onerror="evil()"><svg><script>evil()</script></svg>' +
        '<a href="javascript:evil()">bad</a><a href="https://ok.example/" data-x="1">ok</a>' +
        '<div><ul><li>one</li></ul></div>',
    );
    expect(out).toBe(
      '<p>A <strong>b</strong> c</p><a>bad</a>' +
        '<a href="https://ok.example/" target="_blank" rel="noopener noreferrer">ok</a><ul><li>one</li></ul>',
    );
  });

  it('estimates reading time', () => {
    expect(readingMinutes('<p>word</p>')).toBe(1);
    expect(readingMinutes(`<p>${'word '.repeat(1100)}</p>`)).toBe(5);
  });
});
