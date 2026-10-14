import { describe, expect, it } from 'vitest';
import { docToText, sanitizeDoc } from '../src/shared/richtext';

describe('sanitizeDoc', () => {
  it('keeps allowed structure', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Serwis stołu' }] },
        { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Max 2 talerze', marks: [{ type: 'bold' }] }] }] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Krok' }] }] }] },
        { type: 'image', attrs: { src: '/media/loc/loc_senator/img/abc.webp', alt: 'Nakrycie' } },
      ],
    };
    expect(sanitizeDoc(doc)).toEqual(doc);
  });

  it('drops scripts, foreign images, unsafe links and unknown nodes', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        { type: 'image', attrs: { src: 'https://evil.example/x.png' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'klik', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'heading', attrs: { level: 1, onclick: 'x' }, content: [{ type: 'text', text: 'H' }] },
      ],
    });
    expect(JSON.stringify(doc)).not.toMatch(/script|evil|javascript|onclick/);
    expect(doc!.content!.find((n) => n.type === 'heading')!.attrs).toEqual({ level: 2 });
  });

  it('refuses non-documents', () => {
    expect(sanitizeDoc('<p>hi</p>')).toBeNull();
    expect(sanitizeDoc({ type: 'paragraph' })).toBeNull();
  });
});

describe('docToText', () => {
  it('produces readable plain text with list markers', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Tytuł' }] },
        { type: 'orderedList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pierwszy' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Drugi' }] }] },
        ] },
      ],
    })!;
    expect(docToText(doc)).toBe('Tytuł\n1. Pierwszy\n2. Drugi');
  });
});
