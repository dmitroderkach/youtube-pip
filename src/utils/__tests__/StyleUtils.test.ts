import { describe, it, expect, vi } from 'vitest';
import { StyleUtils } from '../StyleUtils';

vi.mock('../../logger', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock('../../styles', () => ({ CSS_FIXES: '/* mock css */' }));

describe('StyleUtils', () => {
  it('copyStyles clones style elements from source to target', () => {
    const sourceDoc = document.implementation.createHTMLDocument();
    const targetDoc = document.implementation.createHTMLDocument();
    const style = sourceDoc.createElement('style');
    style.textContent = 'body {}';
    sourceDoc.head.appendChild(style);
    StyleUtils.copyStyles(sourceDoc, targetDoc);
    expect(targetDoc.head.querySelectorAll('style').length).toBe(1);
    expect(targetDoc.head.querySelector('style')?.textContent).toBe('body {}');
  });

  it('injectCSSFixes appends style with CSS_FIXES to target head', () => {
    const targetDoc = document.implementation.createHTMLDocument();
    const before = targetDoc.head.children.length;
    StyleUtils.injectCSSFixes(targetDoc);
    expect(targetDoc.head.children.length).toBe(before + 1);
    const added = targetDoc.head.lastElementChild;
    expect(added?.tagName).toBe('STYLE');
    expect(added?.textContent).toContain('mock css');
  });

  it('copyStyles catches appendChild error', () => {
    const sourceDoc = document.implementation.createHTMLDocument();
    const style = sourceDoc.createElement('style');
    sourceDoc.head.appendChild(style);
    const targetDoc = document.implementation.createHTMLDocument();
    vi.spyOn(targetDoc.head, 'appendChild').mockImplementationOnce(() => {
      throw new Error('appendChild');
    });
    expect(() => StyleUtils.copyStyles(sourceDoc, targetDoc)).not.toThrow();
  });

  it('copyStyles catches outer error', () => {
    const sourceDoc = document.implementation.createHTMLDocument();
    vi.spyOn(sourceDoc, 'querySelectorAll').mockImplementationOnce(() => {
      throw new Error('querySelectorAll');
    });
    const targetDoc = document.implementation.createHTMLDocument();
    expect(() => StyleUtils.copyStyles(sourceDoc, targetDoc)).not.toThrow();
  });

  it('injectCSSFixes catches appendChild error', () => {
    const targetDoc = document.implementation.createHTMLDocument();
    vi.spyOn(targetDoc.head, 'appendChild').mockImplementationOnce(() => {
      throw new Error('appendChild');
    });
    expect(() => StyleUtils.injectCSSFixes(targetDoc)).not.toThrow();
  });
});
