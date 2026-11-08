import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { createPiPEntryPointsMocks } from './__mocks__/PiPEntryPoints.mock';
import { PiPEntryPoints } from '../PiPEntryPoints';
import { PiPManager } from '../../core/PiPManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import {
  ENTRY_POINT_CLASSES,
  KEYS,
  PIP_HOTKEY,
  PLAYER_TOOLTIP,
  SHORTS_MENU,
} from '../../constants';
import { I18n } from '../../i18n/I18n';
import { EN_MESSAGES } from '../../i18n/messages';
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
    c.bind(I18n).toInstance(mocks.i18n);
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
      expect(button?.getAttribute('aria-label')).toBe(EN_MESSAGES.PIP);
      expect(button?.hasAttribute('title')).toBe(false);
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

  describe('controls button tooltip', () => {
    const TOOLTIP = `.${ENTRY_POINT_CLASSES.TOOLTIP}`;
    /** Player and button boxes (px), relative to the viewport; the tooltip renders TOOLTIP_SIZE. */
    const PLAYER_BOX = { left: 100, top: 50, width: 800, height: 450 } as const;
    const BUTTON_BOX = { left: 720, top: 447, width: 48, height: 48 } as const;
    const TOOLTIP_SIZE = { width: 106, height: 25 } as const;

    function rect(box: { left: number; top: number; width: number; height: number }): DOMRect {
      return DOMRect.fromRect({ x: box.left, y: box.top, width: box.width, height: box.height });
    }

    function setupBoxes(
      player: HTMLElement,
      button: HTMLElement,
      buttonLeft: number = BUTTON_BOX.left
    ): void {
      vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(rect(PLAYER_BOX));
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
        rect({ ...BUTTON_BOX, left: buttonLeft })
      );
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(TOOLTIP_SIZE.width);
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(TOOLTIP_SIZE.height);
    }

    it('shows a player-style tooltip centered above the button on hover and hides it on leave', () => {
      const { player } = addPlayer();
      entryPoints.initialize();
      const button = document.querySelector<HTMLButtonElement>(BUTTON)!;
      setupBoxes(player, button);

      button.dispatchEvent(new MouseEvent('mouseenter'));
      const tooltip = player.querySelector<HTMLElement>(TOOLTIP)!;
      expect(tooltip.classList.contains('ytp-tooltip')).toBe(true);
      expect(tooltip.classList.contains('ytp-bottom')).toBe(true);
      expect(tooltip.querySelector('.ytp-tooltip-text')?.textContent).toBe(EN_MESSAGES.PIP);
      // The key in YouTube's badge, not in brackets
      expect(tooltip.querySelector('.ytp-tooltip-keyboard-shortcut')?.textContent).toBe(
        PIP_HOTKEY.toUpperCase()
      );
      // aria-hidden on the tooltip itself keeps it transparent in YouTube's CSS
      expect(tooltip.hasAttribute('aria-hidden')).toBe(false);
      expect(tooltip.style.display).toBe('');
      const center = BUTTON_BOX.left - PLAYER_BOX.left + BUTTON_BOX.width / 2;
      expect(tooltip.style.left).toBe(`${Math.round(center - TOOLTIP_SIZE.width / 2)}px`);
      expect(tooltip.style.top).toBe(
        `${BUTTON_BOX.top - PLAYER_BOX.top - TOOLTIP_SIZE.height - PLAYER_TOOLTIP.GAP_PX}px`
      );

      button.dispatchEvent(new MouseEvent('mouseleave'));
      expect(tooltip.style.display).toBe('none');
    });

    it('keeps the tooltip inside the player near its right and left edges', () => {
      const { player } = addPlayer();
      entryPoints.initialize();
      const button = document.querySelector<HTMLButtonElement>(BUTTON)!;

      setupBoxes(player, button, PLAYER_BOX.left + PLAYER_BOX.width - BUTTON_BOX.width);
      button.dispatchEvent(new FocusEvent('focus'));
      const tooltip = player.querySelector<HTMLElement>(TOOLTIP)!;
      expect(tooltip.style.left).toBe(
        `${PLAYER_BOX.width - TOOLTIP_SIZE.width - PLAYER_TOOLTIP.EDGE_PX}px`
      );
      button.dispatchEvent(new FocusEvent('blur'));
      expect(tooltip.style.display).toBe('none');

      vi.restoreAllMocks();
      setupBoxes(player, button, PLAYER_BOX.left);
      button.dispatchEvent(new MouseEvent('mouseenter'));
      expect(tooltip.style.left).toBe(`${PLAYER_TOOLTIP.EDGE_PX}px`);
      expect(player.querySelectorAll(TOOLTIP)).toHaveLength(1);
    });

    it('is hidden when the button is clicked', () => {
      const { player } = addPlayer();
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      const button = document.querySelector<HTMLButtonElement>(BUTTON)!;
      setupBoxes(player, button);
      button.dispatchEvent(new MouseEvent('mouseenter'));

      button.click();

      expect(player.querySelector<HTMLElement>(TOOLTIP)!.style.display).toBe('none');
    });

    it('is not shown for a button outside the player, and leave without a tooltip is harmless', () => {
      addPlayer();
      entryPoints.initialize();
      const button = document.querySelector<HTMLButtonElement>(BUTTON)!;
      document.body.appendChild(button);

      button.dispatchEvent(new MouseEvent('mouseleave'));
      button.dispatchEvent(new MouseEvent('mouseenter'));

      expect(document.querySelector(TOOLTIP)).toBeNull();
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
      expect(item?.textContent).toBe(EN_MESSAGES.PIP);
      for (const part of [menu, panel, list]) {
        expect(part.style.height).toBe(`${MENU_HEIGHT + ITEM_HEIGHT}px`);
      }
    });

    it('stays when the user right-clicks the open menu itself', async () => {
      const { video } = addPlayer();
      const { list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      rightClick(video);
      await afterContextMenu();

      rightClick(list.querySelector(MENU_ITEM)!);
      await afterContextMenu();

      expect(list.firstElementChild?.matches(MENU_ITEM)).toBe(true);
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

  describe('hotkey', () => {
    function press(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
      const e = new KeyboardEvent('keydown', {
        key: PIP_HOTKEY,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(e);
      return e;
    }

    it('plain key on the page opens PiP and is consumed', () => {
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      const e = press(document.body);
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it('upper case works too (Caps Lock)', () => {
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      press(document.body, { key: PIP_HOTKEY.toUpperCase() });
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['Shift (YouTube: previous video)', { shiftKey: true }],
      ['Ctrl (print)', { ctrlKey: true }],
      ['Alt', { altKey: true }],
      ['Meta', { metaKey: true }],
      ['a held key', { repeat: true }],
      ['another key', { key: 'o' }],
    ])('ignores %s', (_name, init) => {
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      press(document.body, init);
      expect(mocks.pipManager.open).not.toHaveBeenCalled();
    });

    it.each(['input', 'textarea'])('ignores typing in a %s', (tag) => {
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      const field = document.createElement(tag);
      document.body.appendChild(field);
      press(field);
      expect(mocks.pipManager.open).not.toHaveBeenCalled();
    });

    it('ignores typing in editable content (comments)', () => {
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      const text = document.createElement('span');
      editor.appendChild(text);
      document.body.appendChild(editor);
      press(text);
      expect(mocks.pipManager.open).not.toHaveBeenCalled();
    });

    it('ignores a key YouTube already handled and a key while PiP is open', () => {
      entryPoints.initialize();
      const handled = (e: Event) => e.preventDefault();
      document.body.addEventListener('keydown', handled);
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      press(document.body);
      document.body.removeEventListener('keydown', handled);

      mocks.pipWindowProvider.getWindow.mockReturnValue(
        createFakeWindow({ document: document.implementation.createHTMLDocument() })
      );
      press(document.body);

      expect(mocks.pipManager.open).not.toHaveBeenCalled();
    });

    it('the button announces the key', () => {
      addPlayer();
      entryPoints.initialize();
      expect(document.querySelector(BUTTON)?.getAttribute('aria-keyshortcuts')).toBe(PIP_HOTKEY);
    });
  });

  describe("YouTube's own PiP entry points", () => {
    it("YouTube's PiP item is hidden and the menu shrinks by its height", async () => {
      const { video } = addPlayer();
      const { menu, list } = addMenu();
      const ytItem = document.createElement('div');
      ytItem.className = 'ytp-menuitem';
      const ytLabel = document.createElement('div');
      ytLabel.className = 'ytp-menuitem-label';
      ytLabel.textContent = EN_MESSAGES.PIP;
      ytItem.appendChild(ytLabel);
      list.appendChild(ytItem);
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      expect(ytItem.style.display).toBe('none');
      // + our item, − YouTube's
      expect(menu.style.height).toBe(`${MENU_HEIGHT}px`);
      // A later opening does not shrink it again
      rightClick(video);
      await afterContextMenu();
      expect(menu.style.height).toBe(`${MENU_HEIGHT}px`);
    });

    it("YouTube's PiP button is hidden by one page style rule", () => {
      entryPoints.initialize();
      entryPoints.stop();
      entryPoints.initialize();
      const styles = document.querySelectorAll(`style#${ENTRY_POINT_CLASSES.PAGE_STYLE}`);
      expect(styles).toHaveLength(1);
      expect(styles[0].textContent).toContain(SELECTORS.YT_PIP_BUTTON);
      document.head.querySelectorAll('style').forEach((s) => s.remove());
    });
  });

  describe('Shorts', () => {
    /** ytd-shorts-player-controls with the menu and full screen buttons, like YouTube renders them. */
    function addShortsControls(): { right: HTMLElement; fullscreen: HTMLElement } {
      const controls = document.createElement('ytd-shorts-player-controls');
      const right = document.createElement('div');
      right.id = 'right-controls';
      const menu = document.createElement('div');
      menu.id = 'menu-button';
      menu.className = 'ytdShortsPlayerControlsMenuButton';
      const fullscreen = document.createElement('div');
      fullscreen.id = 'fullscreen-button-shape';
      fullscreen.className = 'ytdShortsPlayerControlsFullscreenButtonShape';
      const button = document.createElement('button');
      button.className = 'ytSpecButtonShapeNextHost';
      button.title = 'Full screen (f)';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      button.appendChild(svg);
      fullscreen.appendChild(button);
      right.append(menu, fullscreen);
      controls.appendChild(right);
      document.body.appendChild(controls);
      return { right, fullscreen };
    }
    const SHORTS_BUTTON = `.${ENTRY_POINT_CLASSES.SHORTS_BUTTON}`;

    it('adds a copy of the full screen button with our icon, label and key, left of it, once', () => {
      const { fullscreen } = addShortsControls();
      entryPoints.initialize();
      document.dispatchEvent(new Event('pointermove'));

      // Between "⋮" and full screen
      const ours = fullscreen.previousElementSibling as HTMLElement;
      expect(ours.matches(SHORTS_BUTTON)).toBe(true);
      expect(ours.previousElementSibling?.id).toBe('menu-button');
      expect(ours.id).toBe('');
      // Laid out in the "⋮" slot's class (YouTube hides the full screen slot in some layouts)
      expect(ours.classList.contains('ytdShortsPlayerControlsMenuButton')).toBe(true);
      expect(ours.classList.contains('ytdShortsPlayerControlsFullscreenButtonShape')).toBe(false);
      const button = ours.querySelector('button')!;
      expect(button.className).toBe('ytSpecButtonShapeNextHost');
      expect(button.title).toBe(`${EN_MESSAGES.PIP} (${PIP_HOTKEY})`);
      expect(button.getAttribute('aria-label')).toBe(`${EN_MESSAGES.PIP} (${PIP_HOTKEY})`);
      expect(button.querySelector('svg path')?.getAttribute('d')).toBeTruthy();
      expect(document.querySelectorAll(SHORTS_BUTTON)).toHaveLength(1);
    });

    it('our icon goes into the icon container even before YouTube drew its own icon there', () => {
      const { fullscreen } = addShortsControls();
      const button = fullscreen.querySelector('button')!;
      button.replaceChildren();
      const iconSlot = document.createElement('div');
      iconSlot.className = 'ytSpecButtonShapeNextIcon';
      const pending = document.createElement('span');
      iconSlot.appendChild(pending);
      button.appendChild(iconSlot);
      entryPoints.initialize();

      const ours = document.querySelector<HTMLElement>(
        `${SHORTS_BUTTON} .ytSpecButtonShapeNextIcon`
      )!;
      expect(ours.children).toHaveLength(1);
      expect(ours.firstElementChild?.querySelector('path')).not.toBeNull();
    });

    it('click opens PiP without reaching the reel', () => {
      const { right } = addShortsControls();
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      const reelClick = vi.fn();
      right.addEventListener('click', reelClick);

      document.querySelector<HTMLElement>(`${SHORTS_BUTTON} button`)!.click();

      expect(mocks.pipManager.open).toHaveBeenCalledTimes(1);
      expect(reelClick).not.toHaveBeenCalled();
    });

    /** Shorts "⋮" button and the dropdown YouTube opens for it (rows of yt-list-item-view-model). */
    function addShortsMenu(): {
      menuButton: HTMLElement;
      dropdown: HTMLElement;
      list: HTMLElement;
    } {
      const shorts = document.createElement('ytd-shorts');
      const menuButton = document.createElement('div');
      menuButton.id = 'menu-button';
      const inner = document.createElement('button');
      menuButton.appendChild(inner);
      shorts.appendChild(menuButton);
      const popup = document.createElement('ytd-popup-container');
      const dropdown = document.createElement('tp-yt-iron-dropdown');
      const list = document.createElement('div');
      for (const text of ['Description', 'Save to playlist']) {
        const row = document.createElement('yt-list-item-view-model');
        row.className = 'ytListItemViewModelHost';
        const wrap = document.createElement('div');
        wrap.id = 'row-id';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const title = document.createElement('span');
        title.textContent = text;
        wrap.append(icon, title);
        row.appendChild(wrap);
        list.appendChild(row);
      }
      dropdown.appendChild(list);
      popup.appendChild(dropdown);
      document.body.append(shorts, popup);
      return { menuButton, dropdown, list };
    }
    const SHORTS_MENU_ITEM = `.${ENTRY_POINT_CLASSES.SHORTS_MENU_ITEM}`;

    it('"⋮" menu: our item first, a row like YouTube\'s with our label and icon; once per opening', async () => {
      const { menuButton, dropdown, list } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      entryPoints.initialize();

      menuButton.querySelector('button')!.click();
      await vi.runAllTimersAsync();
      menuButton.querySelector('button')!.click();
      await vi.runAllTimersAsync();

      const item = list.firstElementChild as HTMLElement;
      expect(item.matches(SHORTS_MENU_ITEM)).toBe(true);
      expect(item.classList.contains('ytListItemViewModelHost')).toBe(true);
      expect(item.textContent).toBe(EN_MESSAGES.PIP);
      expect(item.querySelector('svg path')).not.toBeNull();
      expect(item.querySelector('[id]')).toBeNull();
      expect(list.querySelectorAll(SHORTS_MENU_ITEM)).toHaveLength(1);
    });

    it('"⋮" menu: YouTube\'s own PiP row is hidden, ours stays', async () => {
      const { menuButton, dropdown, list } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      const ytPip = document.createElement('yt-list-item-view-model');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElement('span');
      title.textContent = EN_MESSAGES.PIP;
      ytPip.append(icon, title);
      list.appendChild(ytPip);
      entryPoints.initialize();

      menuButton.click();
      await vi.runAllTimersAsync();

      expect(ytPip.style.display).toBe('none');
      const ours = list.querySelector<HTMLElement>(SHORTS_MENU_ITEM)!;
      expect(ours.style.display).toBe('');
      expect(ours.textContent).toBe(EN_MESSAGES.PIP);
    });

    it('"⋮" menu: waits for a row whose icon is drawn and copies it; without one by the deadline, adds our icon', async () => {
      const { menuButton, dropdown, list } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      list.querySelectorAll('svg').forEach((svg) => svg.remove());
      entryPoints.initialize();

      menuButton.click();
      await vi.advanceTimersByTimeAsync(SHORTS_MENU.POLL_MS);
      expect(list.querySelector(SHORTS_MENU_ITEM)).toBeNull();

      // YouTube draws the second row's icon
      const rows = list.querySelectorAll('yt-list-item-view-model');
      rows[1].firstElementChild!.prepend(
        document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      );
      await vi.advanceTimersByTimeAsync(SHORTS_MENU.POLL_MS);
      const ours = list.querySelector<HTMLElement>(SHORTS_MENU_ITEM)!;
      expect(ours.querySelector('svg path')).not.toBeNull();

      // Next opening, no icon anywhere until the deadline: our icon is added anyway
      ours.remove();
      list.querySelectorAll('svg').forEach((svg) => svg.remove());
      menuButton.click();
      await vi.runAllTimersAsync();
      expect(list.querySelector(`${SHORTS_MENU_ITEM} svg path`)).not.toBeNull();
    });

    it('"⋮" menu item is highlighted like YouTube\'s rows on hover and focus', async () => {
      const { menuButton, dropdown, list } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      list
        .querySelectorAll('yt-list-item-view-model > div')
        .forEach((d) => d.classList.add('ytListItemViewModelTappable'));
      entryPoints.initialize();
      menuButton.click();
      await vi.runAllTimersAsync();
      const item = list.querySelector<HTMLElement>(SHORTS_MENU_ITEM)!;
      const container = item.querySelector<HTMLElement>('.ytListItemViewModelTappable')!;

      item.dispatchEvent(new MouseEvent('mouseenter'));
      expect(container.classList.contains('ytListItemViewModelHovered')).toBe(true);
      item.dispatchEvent(new MouseEvent('mouseleave'));
      expect(container.classList.contains('ytListItemViewModelHovered')).toBe(false);
      // Focus YouTube gives the first row when the menu opens (not keyboard focus): no highlight
      vi.spyOn(item, 'matches').mockImplementation(
        (sel: string) => sel !== ':focus-visible' && Element.prototype.matches.call(item, sel)
      );
      item.dispatchEvent(new FocusEvent('focus'));
      expect(container.classList.contains('ytListItemViewModelHovered')).toBe(false);
      // Keyboard focus: highlighted
      vi.mocked(item.matches).mockImplementation(
        (sel: string) => sel === ':focus-visible' || Element.prototype.matches.call(item, sel)
      );
      item.dispatchEvent(new FocusEvent('focus'));
      expect(container.classList.contains('ytListItemViewModelHovered')).toBe(true);
      item.dispatchEvent(new FocusEvent('blur'));
      expect(container.classList.contains('ytListItemViewModelHovered')).toBe(false);
    });

    it('"⋮" menu item does not keep the hovered class of a copied row', async () => {
      const { menuButton, dropdown, list } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      list
        .querySelectorAll('yt-list-item-view-model > div')
        .forEach((d) => d.classList.add('ytListItemViewModelHovered'));
      entryPoints.initialize();
      menuButton.click();
      await vi.runAllTimersAsync();
      expect(list.querySelector(`${SHORTS_MENU_ITEM} .ytListItemViewModelHovered`)).toBeNull();
    });

    it('"⋮" menu item: click closes the dropdown and opens PiP; Enter activates it', async () => {
      const { menuButton, dropdown } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      const close = vi.fn();
      Object.assign(dropdown, { close });
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      menuButton.click();
      await vi.runAllTimersAsync();
      const item = document.querySelector<HTMLElement>(SHORTS_MENU_ITEM)!;

      item.click();
      item.dispatchEvent(new KeyboardEvent('keydown', { key: KEYS.ENTER, bubbles: true }));

      expect(close).toHaveBeenCalledTimes(2);
      expect(mocks.pipManager.open).toHaveBeenCalledTimes(2);
    });

    it('"⋮" menu item: a dropdown without close() gets a non-bubbling Escape', async () => {
      const { menuButton, dropdown } = addShortsMenu();
      vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 200, height: 300 })
      );
      mocks.pipManager.open.mockResolvedValue();
      entryPoints.initialize();
      menuButton.click();
      await vi.runAllTimersAsync();
      const keys: KeyboardEvent[] = [];
      dropdown.addEventListener('keydown', (e) => keys.push(e));

      document.querySelector<HTMLElement>(SHORTS_MENU_ITEM)!.click();

      expect(keys.map((e) => [e.key, e.bubbles])).toEqual([[KEYS.ESCAPE, false]]);
    });

    it('"⋮" menu: gives up when no menu shows; other clicks are ignored', async () => {
      const { menuButton, list } = addShortsMenu();
      entryPoints.initialize();
      document.body.click();
      menuButton.click();
      await vi.runAllTimersAsync();
      expect(list.querySelector(SHORTS_MENU_ITEM)).toBeNull();
    });

    it('without a full screen button (not rendered) our button copies the "⋮" slot and goes after it', () => {
      const controls = document.createElement('ytd-shorts-player-controls');
      const right = document.createElement('div');
      right.id = 'right-controls';
      const menu = document.createElement('div');
      menu.id = 'menu-button';
      menu.className = 'ytdShortsPlayerControlsMenuButton';
      right.appendChild(menu);
      controls.appendChild(right);
      document.body.appendChild(controls);
      entryPoints.initialize();

      const ours = menu.nextElementSibling as HTMLElement;
      expect(ours.matches(SHORTS_BUTTON)).toBe(true);
      expect(ours.id).toBe('');
      // No button inside the copied slot: the slot itself is the button
      expect(ours.querySelector('svg')).not.toBeNull();
      expect(ours.getAttribute('title')).toBe(`${EN_MESSAGES.PIP} (${PIP_HOTKEY})`);
    });

    it('context menu opened on the Shorts player gets the item', async () => {
      const shortsPlayer = document.createElement('div');
      shortsPlayer.id = SELECTORS.SHORTS_PLAYER.slice(1);
      const video = document.createElement('video');
      shortsPlayer.appendChild(video);
      document.body.appendChild(shortsPlayer);
      const { list } = addMenu();
      mocks.pipWindowProvider.getWindow.mockReturnValue(null);
      entryPoints.initialize();

      rightClick(video);
      await afterContextMenu();

      expect(list.firstElementChild?.matches(MENU_ITEM)).toBe(true);
    });
  });
});
