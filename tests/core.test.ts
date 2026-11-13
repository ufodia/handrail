import { describe, expect, test } from 'vitest';
import {
  advanceReplay,
  appendRecordedStep,
  isContentSender,
  isPopupSender,
  isSafeSelector,
  MAX_JSON_BYTES,
  normalizePageUrl,
  parseGuideJson,
  validateGuide,
  validateGuides,
  validateSession,
  validateStep,
  type Guide,
  type GuideStep,
  type Session,
} from '../src/core';

const step = (overrides: Partial<GuideStep> = {}): GuideStep => ({
  id: 'open',
  pathname: '/practice.html',
  selector: '#open-preferences',
  tag: 'button',
  role: 'button',
  name: 'Open preferences',
  instruction: 'Choose Open preferences',
  ...overrides,
});
const guide = (overrides: Partial<Guide> = {}): Guide => ({
  version: 1,
  id: 'guide-1',
  name: 'Practice route',
  description: '',
  origin: 'https://example.com',
  steps: [
    step(),
    step({ id: 'next', pathname: '/practice-next.html', selector: '#finish', name: 'Finish' }),
  ],
  ...overrides,
});
const session = (overrides: Partial<Session> = {}): Session => ({
  version: 1,
  tabId: 2,
  token: 'token-1',
  documentId: 'document-1',
  mode: 'replay',
  status: 'active',
  origin: 'https://example.com',
  guide: guide(),
  stepIndex: 0,
  reason: '',
  ...overrides,
});
const sender = (overrides = {}) => ({
  id: 'extension-id',
  tab: { id: 2 },
  frameId: 0,
  documentId: 'document-1',
  documentLifecycle: 'active',
  url: 'https://example.com/practice.html?private=discarded#also-discarded',
  ...overrides,
});

describe('stored identity and bounded schema', () => {
  test('normalizes origin/path without storing query, fragment or default port', () => {
    expect(normalizePageUrl('https://EXAMPLE.com:443/practice.html?token=secret#section')).toEqual({
      origin: 'https://example.com',
      pathname: '/practice.html',
      url: 'https://example.com/practice.html',
    });
  });
  test.each([
    'file:///private',
    'chrome://settings',
    'chrome-extension://id/popup.html',
    'data:text/html,hello',
    'https://user:password@example.com/',
    'not a url',
  ])('rejects unsupported identity %s', (value) => {
    expect(() => normalizePageUrl(value)).toThrow();
  });
  test('accepts authored text as inert data and strips unknown properties', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const parsed = validateGuide({
      ...guide({ name: hostile }),
      secret: 'not retained',
      steps: [{ ...step({ instruction: hostile }), value: 'not retained' }],
    });
    expect(parsed.name).toBe(hostile);
    expect(parsed.steps[0]!.instruction).toBe(hostile);
    expect(JSON.stringify(parsed)).not.toContain('not retained');
  });
  test.each([
    'https://example.com/',
    'https://example.com/path',
    'https://EXAMPLE.com',
    'https://example.com?token=x',
    'https://example.com#x',
  ])('rejects noncanonical guide origin %s', (origin) => {
    expect(() => validateGuide(guide({ origin }))).toThrow();
  });
  test('recording drafts can be empty while imported/saved guides cannot', () => {
    expect(validateGuide(guide({ steps: [] }), true).steps).toHaveLength(0);
    expect(() => validateGuide(guide({ steps: [] }))).toThrow();
    expect(() => parseGuideJson(JSON.stringify(guide({ steps: [] })))).toThrow();
  });
  test('enforces step and guide count limits and duplicate identifiers', () => {
    expect(() =>
      validateGuide(
        guide({ steps: Array.from({ length: 41 }, (_, i) => step({ id: `step-${i}` })) }),
      ),
    ).toThrow();
    expect(() => validateGuide(guide({ steps: [step(), step()] }))).toThrow();
    expect(() =>
      validateGuides(Array.from({ length: 21 }, (_, i) => guide({ id: `guide-${i}` }))),
    ).toThrow();
    expect(() => validateGuides([guide(), guide()])).toThrow();
  });
  test.each(['/page?token=x', '/page#section', '//different.example/path', '/foo\\bar'])(
    'rejects non-path step identity %s',
    (pathname) => {
      expect(() => validateStep(step({ pathname }))).toThrow();
    },
  );
  test.each(['input', 'textarea', 'select', 'iframe', 'script', 'body'])(
    'rejects unsupported target tag %s',
    (tag) => {
      expect(() => validateStep(step({ tag }))).toThrow();
    },
  );
  test('enforces short labels and actual supported control roles', () => {
    expect(() => validateStep(step({ name: 'x'.repeat(81) }))).toThrow();
    expect(() => validateStep(step({ instruction: 'x'.repeat(241) }))).toThrow();
    expect(() => validateStep(step({ role: 'textbox' }))).toThrow();
  });
  test('uses a UTF-8 byte bound before parsing imported JSON', () => {
    expect(parseGuideJson(JSON.stringify(guide()))).toEqual(guide());
    expect(() => parseGuideJson('{not json}')).toThrow();
    const largeUnicode = JSON.stringify({
      ...guide(),
      description: '😀'.repeat(MAX_JSON_BYTES / 4),
    });
    expect(largeUnicode.length).toBeLessThan(MAX_JSON_BYTES);
    expect(() => parseGuideJson(largeUnicode)).toThrow(/256 KiB/);
  });
});

describe('restricted selectors', () => {
  test.each([
    '#open-preferences',
    '#\\31 23',
    '[data-testid="next"]',
    '[data-qa="a\\"b"]',
    'body > main:nth-of-type(1) > button:nth-of-type(2)',
  ])('accepts recordable selector %s', (selector) => {
    expect(isSafeSelector(selector)).toBe(true);
  });
  test.each([
    '*',
    'button',
    'button, input',
    'a[href*="secret"]',
    '[value="private"]',
    '#x:has(input)',
    'body button:nth-of-type(1)',
    '#x > script',
    '#x\n',
    '#x'.repeat(300),
  ])('rejects expanded selector %s', (selector) => {
    expect(isSafeSelector(selector)).toBe(false);
  });
});

describe('session and sender boundaries', () => {
  test('popup authority requires the exact extension popup URL', () => {
    expect(
      isPopupSender(
        { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' },
        'extension-id',
      ),
    ).toBe(true);
    expect(
      isPopupSender(
        { id: 'other', url: 'chrome-extension://extension-id/popup.html' },
        'extension-id',
      ),
    ).toBe(false);
    expect(
      isPopupSender({ id: 'extension-id', url: 'https://example.com/popup.html' }, 'extension-id'),
    ).toBe(false);
  });
  test('binds content authority to extension, tab, top frame and exact document', () => {
    expect(
      isContentSender(sender(), session(), 'https://example.com/practice.html', 'extension-id'),
    ).toBe(true);
    for (const changed of [
      { id: 'other' },
      { tab: { id: 3 } },
      { frameId: 1 },
      { documentId: 'old-document' },
      { documentLifecycle: 'cached' },
    ]) {
      expect(
        isContentSender(
          sender(changed),
          session(),
          'https://example.com/practice.html',
          'extension-id',
        ),
      ).toBe(false);
    }
  });
  test('permits a trusted prior-document click during same-origin navigation only', () => {
    expect(
      isContentSender(
        sender(),
        session(),
        'https://example.com/practice-next.html',
        'extension-id',
      ),
    ).toBe(true);
    expect(
      isContentSender(
        sender(),
        session(),
        'https://different.example/practice-next.html',
        'extension-id',
      ),
    ).toBe(false);
    expect(
      isContentSender(
        sender({ url: 'https://example.com/wrong-path' }),
        session(),
        'https://example.com/practice.html',
        'extension-id',
      ),
    ).toBe(false);
  });
  test('rejects session mismatches and impossible progress', () => {
    expect(() => validateSession(session({ origin: 'https://other.example' }))).toThrow();
    expect(() => validateSession(session({ stepIndex: 3 }))).toThrow();
    expect(() => validateSession(session({ stepIndex: 2, status: 'active' }))).toThrow();
    expect(() => validateSession(session({ mode: 'record', stepIndex: 0 }))).toThrow();
  });
  test('recording appends a validated snapshot without mutating prior state', () => {
    const before = session({ mode: 'record', guide: guide({ steps: [] }), stepIndex: 0 });
    const after = appendRecordedStep(before, step(), 0);
    expect(before.guide.steps).toHaveLength(0);
    expect(after.guide.steps).toHaveLength(1);
    expect(after.stepIndex).toBe(1);
    expect(() => appendRecordedStep(after, step({ id: 'another' }), 0)).toThrow();
    expect(() => appendRecordedStep(after, step(), 1)).toThrow();
    expect(() =>
      appendRecordedStep({ ...after, status: 'paused' }, step({ id: 'another' }), 1),
    ).toThrow();
  });
  test('replay advances exactly one expected step and completes after actual answers', () => {
    const first = advanceReplay(session(), 0, 'open');
    expect(first.stepIndex).toBe(1);
    expect(first.status).toBe('active');
    const last = advanceReplay(first, 1, 'next');
    expect(last.stepIndex).toBe(2);
    expect(last.status).toBe('complete');
    expect(session().stepIndex).toBe(0);
    expect(() => advanceReplay(first, 0, 'open')).toThrow();
    expect(() => advanceReplay(first, 1, 'wrong-id')).toThrow();
    expect(() => advanceReplay({ ...first, status: 'paused' }, 1, 'next')).toThrow();
    expect(() => advanceReplay(last, 2, 'next')).toThrow();
  });
});
