import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { createPiPEntryPointsMocks } from './__mocks__/PiPEntryPoints.mock';
import { PiPEntryPoints } from '../PiPEntryPoints';
import { PiPManager } from '../../core/PiPManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { ENTRY_POINT_CLASSES, ENTRY_POINT_LABELS, KEYS } from '../../constants';
import { SELECTORS } from '../../selectors';

/** Height of a menu item, as YouTube renders it. */
const ITEM_HEIGHT = 40;
/** Inline height YouTube gives the menu for its own items. */
const MENU_HEIGHT = 337;
const MENU_ITEM = `.${ENTRY_POINT_CLASSES.MENU_ITEM}`;
const BUTTON = `.${ENTRY_POINT_CLASSES.BUTTON}`;

/** #movie_player with a video and the right controls (settings button), like the watch / mini player. */
function addPlayer(): { player: HTMLElement; video: HTMLElement; settings: HTMLElement } {
  const player = document.createElement('div');
  player.id = 'movie_player';
  const video = document.createElement('video');
  const controls = document.createElement('div');
  controls.className = 'ytp-right-controls';
  const settings = document.createElement('button');
  settings.className = 'ytp-button ytp-settings-button';
  controls.appendChild(settings);
  player.append(video, controls);
  document.body.appendChild(player);
  return { player, video, settings };
}

/** body > .ytp-popup.ytp-contextmenu with sized panel and one YouTube item. */
function addMenu(display = ''): { menu: HTMLElement; panel: HTMLElement; list: HTMLElement } {
  const menu = document.createElement('div');
  menu.className = 'ytp-popup ytp-contextmenu';
  menu.style.height = `${MENU_HEIGHT}px`;
  menu.style.display = display;
  const panel = document.createElement('div');
  panel.className = 'ytp-panel';
  panel.style.height = `${MENU_HEIGHT}px`;
  const list = document.createElement('div');
  list.className = 'ytp-panel-menu';
  list.style.height = `${MENU_HEIGHT}px`;
  const youtubeItem = document.createElement('div');
  youtubeItem.className = 'ytp-menuitem';
  list.appendChild(youtubeItem);
  panel.appendChild(list);
  menu.appendChild(panel);
  document.body.appendChild(menu);
  return { menu, panel, list };
}

function rightClick(target: Element): void {
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}

/** Let the contextmenu handler's deferred pass run. */
async function afterContextMenu(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe('PiPEntryPoints', () => {
  let entryPoints: PiPEntryPoints;
  let mocks: ReturnType<typeof createPiPEntryPointsMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ITEM_HEIGHT);
    mocks = createPiPEntryPointsMocks();
    const c = createTestContainer();
    c.bind(PiPManager).toInstance(mocks.pipManager);
    c.bind(PipWindowProvider).toInstance(mocks.pipWindowProvider);
    c.bind(PiPEntryPoints).toSelf();
    entryPoints = c.get(PiPEntryPoints);
  });

  afterEach(() => {
    entryPoints.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('controls button', () => {
    it('is added before the settings button on initialize', () => {
      const { settings } = addPlayer();
      entryPoints.initialize();
      const button = document.querySelector<HTMLButtonElement>(BUTTON);
      expect(button?.nextElementSibling).toBe(settings);
      expect(button?.getAttribute('aria-label')).toBe(ENTRY_POINT_LABELS.BUTTON);
      expect(button?.querySelector('svg path')).not.toBeNull();
    });

    it('is added on pointer movement once the controls exist, and only once', () => {
      entryPoints.initialize();
      expect(document.querySelector(BUTTON)).toBeNull();
      addPlayer();
      document.dispatchEvent(new Event('pointermove'));
      document.dispatchEvent(new Event('pointermove'));
      expect(document.querySelectorAll(BUTTON)).toHaveLength(1);
    });

    it('is re-added when YouTube rebuilt the controls', () => {
      const { player } = addPlayer();
      entryPoints.initialize();
      player.remove();
      const { settings } = addPlayer();
      document.dispatchEvent(new Event('pointermove'));
      expect(settings.previousElementSibling?.matches(BUTTON)).toBe(true);
    });

    it('opens PiP on click', async () => {
      addPlayer();
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      document.querySelector<HTMLButtonElement>(BUTTON)!.click();
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
    });

    it('a failed open is logged, not thrown', async () => {
      addPlayer();
      mocks.pipManager.open.mockRejectedValue(new Error('no window'));
      entryPoints.initialize();
      expect(() => document.querySelector<HTMLButtonElement>(BUTTON)!.click()).not.toThrow();
      await vi.runAllTimersAsync();
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('context menu item', () => {
    it('is added first to the menu opened on the player, and the menu grows by its height', async () => {
      const { video } = addPlayer();
      const { menu, panel, list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      const item = list.firstElementChild;
      expect(item?.matches(MENU_ITEM)).toBe(true);
      expect(item?.textContent).toBe(ENTRY_POINT_LABELS.MENU_ITEM);
      for (const part of [menu, panel, list]) {
        expect(part.style.height).toBe(`${MENU_HEIGHT + ITEM_HEIGHT}px`);
      }
    });

    it('is not added for a menu opened outside the player', async () => {
      addPlayer();
      const { list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(document.body);
      await afterContextMenu();

      expect(list.querySelector(MENU_ITEM)).toBeNull();
    });

    it('is not added to a hidden menu', async () => {
      const { video } = addPlayer();
      const { list } = addMenu('none');
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      expect(list.querySelector(MENU_ITEM)).toBeNull();
    });

    it('stays in the menu between openings without resizing it again', async () => {
      const { video } = addPlayer();
      const { menu, list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();

      // YouTube sizes the next opening itself, with the item already in the menu
      menu.style.height = `${MENU_HEIGHT + ITEM_HEIGHT}px`;
      rightClick(video);
      await afterContextMenu();

      expect(list.querySelectorAll(MENU_ITEM)).toHaveLength(1);
      expect(menu.style.height).toBe(`${MENU_HEIGHT + ITEM_HEIGHT}px`);
    });

    it('is removed when the menu shows while PiP is open, and the menu shrinks back', async () => {
      const { video } = addPlayer();
      const { menu, list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();

      // PiP opened; YouTube shows the menu again (sized with the item still in it)
      mocks.pipWindowProvider.getWindow.mockReturnValue(
        createFakeWindow({ document: document.implementation.createHTMLDocument() })
      );
      menu.style.display = 'none';
      await vi.runAllTimersAsync();
      menu.style.display = '';
      await vi.runAllTimersAsync();

      expect(list.querySelector(MENU_ITEM)).toBeNull();
      expect(menu.style.height).toBe(`${MENU_HEIGHT}px`);
    });

    it('click closes the menu with a non-bubbling Escape on it and opens PiP', async () => {
      const { video } = addPlayer();
      const { menu, list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();

      const keys: KeyboardEvent[] = [];
      menu.addEventListener('keydown', (e) => {
        keys.push(e);
        menu.style.display = 'none';
      });
      const onDocument = vi.fn();
      document.addEventListener('keydown', onDocument);
      list.querySelector<HTMLElement>(MENU_ITEM)!.click();

      expect(keys.map((e) => [e.key, e.bubbles])).toEqual([[KEYS.ESCAPE, false]]);
      expect(onDocument).not.toHaveBeenCalled();
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
      document.removeEventListener('keydown', onDocument);
    });

    it('click on an already hidden menu only opens PiP', async () => {
      const { video } = addPlayer();
      const { menu, list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();
      const item = list.querySelector<HTMLElement>(MENU_ITEM)!;
      menu.style.display = 'none';
      const onKey = vi.fn();
      menu.addEventListener('keydown', onKey);

      item.click();

      expect(onKey).not.toHaveBeenCalled();
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
    });

    it('Enter and Space on the item activate it; other keys do not', async () => {
      const { video } = addPlayer();
      const { list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();
      const item = list.querySelector<HTMLElement>(MENU_ITEM)!;

      for (const key of [KEYS.ENTER, KEYS.SPACE, KEYS.ESCAPE]) {
        item.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }

      expect(mocks.pipManager.open).toHaveBeenCalledTimes(2);
    });

    it('ignores a menu without its item list', async () => {
      const { video } = addPlayer();
      const menu = document.createElement('div');
      menu.className = 'ytp-popup ytp-contextmenu';
      document.body.appendChild(menu);
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      expect(document.querySelector(MENU_ITEM)).toBeNull();
    });

    it('leaves menus without inline heights alone', async () => {
      const { video } = addPlayer();
      const { menu, panel, list } = addMenu();
      for (const part of [menu, panel, list]) part.style.removeProperty('height');
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      expect(list.firstElementChild?.matches(MENU_ITEM)).toBe(true);
      expect(menu.style.height).toBe('');
    });

    it('does nothing for a context menu event without an element target', async () => {
      addPlayer();
      const { list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await afterContextMenu();

      expect(list.querySelector(MENU_ITEM)).toBeNull();
      expect(SELECTORS.CONTEXT_MENU).toContain('ytp-contextmenu');
    });
  });
});
