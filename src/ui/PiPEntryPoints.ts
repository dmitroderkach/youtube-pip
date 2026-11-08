import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PiPManager } from '../core/PiPManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import {
  ENTRY_POINT_CLASSES,
  KEY_CODES,
  KEYS,
  PIP_HOTKEY,
  PIP_ICON_PATH,
  PLAYER_TOOLTIP,
  SHORTS_MENU,
} from '../constants';
import { isTypingTarget, isPlainKey } from '../utils/hotkeys';
import { I18n } from '../i18n/I18n';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';
import { inject, injectable } from '../di';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Extra ways to open our PiP from the page, labelled with YouTube's own texts in the interface language (I18n):
 * - an item at the top of the player's context menu (watch page, mini player and Shorts), never in the PiP window;
 * - the PIP_HOTKEY key on the page (closing PiP with it in the PiP window is PiPHotkeyHandler);
 * - a button in the player controls next to the settings button, with a tooltip like YouTube's own buttons (hidden in
 *   the PiP window by styles.css).
 *
 * YouTube sizes the context menu when it opens (inline heights of popup / panel / menu), counting the items that are
 * in it at that moment. The item stays in the menu once added, so later openings are sized with it; when it is
 * added or removed while the menu is already shown (first opening, PiP opened or closed since), the inline heights
 * are corrected by the item's height. Added at the top so the copy items keep their positions from the end
 * (COPY_MENU_POSITIONS_FROM_END).
 */
@injectable()
export class PiPEntryPoints {
  private readonly logger: Logger;
  private menuItem: Nullable<HTMLElement> = null;
  private button: Nullable<HTMLButtonElement> = null;
  /** Our tooltip of the button, built like the player's `.ytp-tooltip` (YouTube's CSS styles it). */
  private tooltip: Nullable<HTMLElement> = null;
  /** Element the last context menu on the page was opened for. */
  private lastContextTarget: Nullable<Element> = null;
  private readonly observedMenus = new WeakSet<HTMLElement>();
  private readonly menuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      this.reconcileMenu(mutation.target as HTMLElement);
    }
  });

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PiPManager) private readonly pipManager: PiPManager,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(I18n) private readonly i18n: I18n
  ) {
    this.logger = loggerFactory.create('PiPEntryPoints');
  }

  public initialize(): void {
    document.addEventListener('contextmenu', this.onContextMenu, true);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('click', this.onClick, true);
    // The controls are shown on pointer movement over the player: a cheap check that our button is still there
    document.addEventListener('pointermove', this.ensureControlsButton, {
      capture: true,
      passive: true,
    });
    this.ensureControlsButton();
    this.hideYouTubePiPButton();
    this.logger.debug('PiP entry points initialized');
  }

  /** Remove the listeners and stop watching the menus (the added item and button stay). */
  public stop(): void {
    document.removeEventListener('contextmenu', this.onContextMenu, true);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('pointermove', this.ensureControlsButton, true);
    this.menuObserver.disconnect();
  }

  /** PIP_HOTKEY on the page opens PiP, unless the user is typing or YouTube already handled the key. */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || !isPlainKey(e, PIP_HOTKEY) || isTypingTarget(e.target)) return;
    if (this.pipWindowProvider.getWindow() !== null) return;
    e.preventDefault();
    this.openPiP('hotkey');
  };

  /** A click on a Shorts "⋮" button: add our item to the menu YouTube opens for it. */
  private onClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target?.closest(SELECTORS.SHORTS_MENU_BUTTON)) return;
    this.waitForShortsMenu(Date.now() + SHORTS_MENU.WAIT_MS);
  };

  /** Poll for the opened Shorts "⋮" menu (YouTube renders it into ytd-popup-container after the click). */
  private waitForShortsMenu(deadline: number): void {
    const list = this.shownShortsMenuList();
    if (list) {
      this.ensureShortsMenuItem(list);
      return;
    }
    if (Date.now() < deadline) {
      window.setTimeout(() => this.waitForShortsMenu(deadline), SHORTS_MENU.POLL_MS);
    }
  }

  /** Parent of the items of the shown Shorts "⋮" menu (`yt-list-item-view-model` rows), or null. */
  private shownShortsMenuList(): Nullable<HTMLElement> {
    for (const dropdown of Array.from(
      document.querySelectorAll<HTMLElement>(SELECTORS.POPUP_DROPDOWN)
    )) {
      if (dropdown.getBoundingClientRect().height <= 0) continue;
      const row = dropdown.querySelector<HTMLElement>(SELECTORS.LIST_ITEM);
      if (row?.parentElement) return row.parentElement;
    }
    return null;
  }

  /**
   * Our item at the top of the Shorts "⋮" menu, built from a copy of YouTube's first row (its inner markup in a plain
   * element: a copied view-model element would render itself empty without its data) with our icon and label.
   */
  private ensureShortsMenuItem(list: HTMLElement): void {
    if (list.querySelector(`.${ENTRY_POINT_CLASSES.SHORTS_MENU_ITEM}`)) return;
    const row = list.querySelector<HTMLElement>(SELECTORS.LIST_ITEM);
    if (!row) return;
    const item = document.createElement('div');
    item.className = `${row.className} ${ENTRY_POINT_CLASSES.SHORTS_MENU_ITEM}`;
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    for (const child of Array.from(row.childNodes)) item.appendChild(child.cloneNode(true));
    const rowText = row.textContent?.trim() ?? '';
    const label = Array.from(item.querySelectorAll<HTMLElement>('*'))
      .reverse()
      .find((e) => e.children.length === 0 && (e.textContent?.trim() ?? '') === rowText);
    if (label) label.textContent = this.i18n.t('PIP');
    else item.appendChild(document.createTextNode(this.i18n.t('PIP')));
    const svg = item.querySelector('svg');
    if (svg) svg.replaceWith(this.createIcon());
    item.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.closeDropdown(item.closest<HTMLElement>(SELECTORS.POPUP_DROPDOWN));
      this.openPiP('Shorts menu');
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === KEYS.ENTER || e.key === KEYS.SPACE) {
        e.preventDefault();
        item.click();
      }
    });
    list.prepend(item);
    this.logger.debug('PiP item added to the Shorts menu');
  }

  /** Close YouTube's dropdown the way it closes itself (its close(); Escape on it otherwise). */
  private closeDropdown(dropdown: Nullable<HTMLElement>): void {
    if (!dropdown) return;
    const closable = dropdown as HTMLElement & { close?: () => void };
    if (typeof closable.close === 'function') closable.close();
    else {
      dropdown.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: KEYS.ESCAPE,
          keyCode: KEY_CODES.ESCAPE,
          bubbles: false,
        })
      );
    }
  }

  /** Capture phase, before YouTube opens the menu: remember the target and watch the menus. */
  private onContextMenu = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    // A right-click on the open menu itself (the browser shows its own menu over it) is not a new menu: the shown
    // one keeps its target, and with it our item
    if (target?.closest(SELECTORS.CONTEXT_MENU_CONTAINER)) return;
    this.lastContextTarget = target;
    this.observeMenus();
    // The first menu is created by YouTube's own handler of this event: pick it up afterwards
    window.setTimeout(() => {
      this.observeMenus();
      document
        .querySelectorAll<HTMLElement>(SELECTORS.CONTEXT_MENU)
        .forEach((menu) => this.reconcileMenu(menu));
    }, 0);
  };

  private observeMenus(): void {
    document.querySelectorAll<HTMLElement>(SELECTORS.CONTEXT_MENU).forEach((menu) => {
      if (this.observedMenus.has(menu)) return;
      this.observedMenus.add(menu);
      // Stays attached when the menu moves to the PiP document and back
      this.menuObserver.observe(menu, { attributes: true, attributeFilter: ['style'] });
    });
  }

  /** The item belongs to a shown menu of the page's watch / mini player / Shorts player while PiP is closed. */
  private wantsItem(menu: HTMLElement): boolean {
    const target = this.lastContextTarget;
    return (
      this.pipWindowProvider.getWindow() === null &&
      menu.ownerDocument === document &&
      target?.ownerDocument === document &&
      target.closest(`${SELECTORS.MOVIE_PLAYER}, ${SELECTORS.SHORTS_PLAYER}`) != null
    );
  }

  private reconcileMenu(menu: HTMLElement): void {
    if (menu.style.display === 'none') return;
    const list = menu.querySelector<HTMLElement>(SELECTORS.PANEL_MENU);
    if (!list) return;
    this.hideYouTubePiPItems(menu, list);
    const item = this.menuItem;
    const present = item !== null && item.parentElement === list;
    const wanted = this.wantsItem(menu);
    if (wanted && !present) {
      const newItem = item ?? this.createMenuItem();
      list.prepend(newItem);
      this.resizeMenu(menu, newItem.offsetHeight);
      this.logger.debug('PiP item added to the context menu');
    } else if (!wanted && present) {
      const height = item.offsetHeight;
      item.remove();
      this.resizeMenu(menu, -height);
      this.logger.debug('PiP item removed from the context menu');
    }
  }

  /**
   * YouTube's own "Picture-in-picture" item (`web_watch_pip_context_menu_button`) opens YouTube's PiP, not ours, and
   * would sit next to our item: hidden. Recognized by its label, YouTube's name of PiP in the page language, which is
   * our PIP text (taken from the same player strings).
   */
  private hideYouTubePiPItems(menu: HTMLElement, list: HTMLElement): void {
    const label = this.i18n.t('PIP');
    for (const item of Array.from(list.children) as HTMLElement[]) {
      if (item === this.menuItem || item.style.display === 'none') continue;
      if (item.querySelector(SELECTORS.MENU_ITEM_LABEL)?.textContent?.trim() !== label) continue;
      const height = item.offsetHeight;
      item.style.display = 'none';
      this.resizeMenu(menu, -height);
      this.logger.debug("YouTube's own PiP item hidden in the context menu");
    }
  }

  /** Correct YouTube's inline heights of the shown menu by `delta` px. */
  private resizeMenu(menu: HTMLElement, delta: number): void {
    if (!delta) return;
    const parts = [
      menu,
      menu.querySelector<HTMLElement>(SELECTORS.PANEL),
      menu.querySelector<HTMLElement>(SELECTORS.PANEL_MENU),
    ];
    for (const part of parts) {
      const height = part ? parseFloat(part.style.height) : NaN;
      if (part && !Number.isNaN(height)) part.style.height = `${height + delta}px`;
    }
  }

  private createMenuItem(): HTMLElement {
    const item = document.createElement('div');
    item.className = `${SELECTORS.MENU_ITEM.slice(1)} ${ENTRY_POINT_CLASSES.MENU_ITEM}`;
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    const icon = document.createElement('div');
    icon.className = 'ytp-menuitem-icon';
    icon.appendChild(this.createIcon());
    const label = document.createElement('div');
    label.className = 'ytp-menuitem-label';
    label.textContent = this.i18n.t('PIP');
    const content = document.createElement('div');
    content.className = 'ytp-menuitem-content';
    item.append(icon, label, content);
    item.addEventListener('click', () => {
      this.closeMenu(item.closest<HTMLElement>(SELECTORS.CONTEXT_MENU_CONTAINER));
      this.openPiP('context menu');
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === KEYS.ENTER || e.key === KEYS.SPACE) {
        e.preventDefault();
        item.click();
      }
    });
    this.menuItem = item;
    return item;
  }

  /**
   * Close the menu through YouTube: Escape on the menu element runs its own close (hiding the element ourselves would
   * leave YouTube's "open" state behind). Not bubbling: Escape on the document closes the mini player.
   */
  private closeMenu(menu: Nullable<HTMLElement>): void {
    if (!menu || menu.style.display === 'none') return;
    // YouTube's popup key handler reads the legacy keyCode
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: KEYS.ESCAPE, keyCode: KEY_CODES.ESCAPE, bubbles: false })
    );
    if (menu.style.display !== 'none') {
      this.logger.warn('Context menu still shown after Escape');
    }
  }

  /**
   * YouTube's own PiP button of the controls (`web_watch_pip`) opens YouTube's PiP, not ours, and would sit next to our
   * button: hidden on the page by a style rule (YouTube toggles its inline display itself).
   */
  private hideYouTubePiPButton(): void {
    if (document.getElementById(ENTRY_POINT_CLASSES.PAGE_STYLE)) return;
    const style = document.createElement('style');
    style.id = ENTRY_POINT_CLASSES.PAGE_STYLE;
    style.textContent = `${SELECTORS.MOVIE_PLAYER} ${SELECTORS.YT_PIP_BUTTON} { display: none !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  /** Our button before the settings button of the page's player; re-added when YouTube rebuilt the controls. */
  private ensureControlsButton = (): void => {
    this.ensureShortsButtons();
    if (this.button?.isConnected) return;
    const settings = document.querySelector(
      `${SELECTORS.MOVIE_PLAYER} ${SELECTORS.SETTINGS_BUTTON}`
    );
    if (!settings?.parentElement) return;
    const button = this.button ?? this.createButton();
    settings.parentElement.insertBefore(button, settings);
    this.logger.debug('PiP button added to the player controls');
  };

  /**
   * Our button left of the full screen button in every Shorts player's top controls (`ytd-shorts-player-controls`,
   * one per reel, rendered for signed-in users). A copy of YouTube's full screen button with our icon, label and
   * click, so it looks and lays out like its neighbours; like YouTube's own buttons there, its tooltip is `title`.
   */
  private ensureShortsButtons(): void {
    document
      .querySelectorAll<HTMLElement>(SELECTORS.SHORTS_MENU_BUTTON_SLOT)
      .forEach((menuSlot) => {
        const next = menuSlot.nextElementSibling;
        if (next?.classList.contains(ENTRY_POINT_CLASSES.SHORTS_BUTTON)) return;
        const fullscreen = menuSlot.parentElement?.querySelector<HTMLElement>(
          SELECTORS.SHORTS_FULLSCREEN_SLOT
        );
        menuSlot.after(this.createShortsButton(menuSlot, fullscreen ?? null));
        this.logger.debug('PiP button added to the Shorts player controls');
      });
  }

  /**
   * Right after the "⋮" slot, i.e. left of the full screen button. Laid out in the "⋮" slot's class: YouTube always
   * shows that slot, while it hides the full screen slot in some layouts (small window) or does not render it
   * (`web_shorts_hide_fullscreen_and_captions_for_ask`). The button inside is a copy of the full screen button (same
   * style), or of the "⋮" button without one.
   */
  private createShortsButton(
    menuSlot: HTMLElement,
    fullscreen: Nullable<HTMLElement>
  ): HTMLElement {
    const shape = (fullscreen ?? menuSlot).cloneNode(true) as HTMLElement;
    shape.removeAttribute('id');
    shape.className = menuSlot.className;
    shape.classList.add(ENTRY_POINT_CLASSES.SHORTS_BUTTON);
    const label = `${this.i18n.t('PIP')} (${PIP_HOTKEY})`;
    const button = shape.querySelector('button') ?? shape;
    button.setAttribute('title', label);
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-keyshortcuts', PIP_HOTKEY);
    // YouTube draws the copied button's own icon later (its SVG may not be there yet): our icon goes into the icon
    // container itself, whatever it holds now
    const iconSlot = button.querySelector(SELECTORS.SPEC_BUTTON_ICON);
    if (iconSlot) iconSlot.replaceChildren(this.createIcon());
    else button.querySelector('svg')?.remove();
    if (!iconSlot) button.appendChild(this.createIcon());
    shape.addEventListener('click', (e) => {
      // The reel would toggle play / pause on the click
      e.stopPropagation();
      e.preventDefault();
      this.openPiP('Shorts controls button');
    });
    return shape;
  }

  private createButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `ytp-button ${ENTRY_POINT_CLASSES.BUTTON}`;
    // No `title`: the browser's own tooltip would show next to ours
    button.setAttribute('aria-label', this.i18n.t('PIP'));
    button.setAttribute('aria-keyshortcuts', PIP_HOTKEY);
    button.appendChild(this.createIcon());
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideTooltip();
      this.openPiP('controls button');
    });
    button.addEventListener('mouseenter', () => this.showTooltip(button));
    button.addEventListener('focus', () => this.showTooltip(button));
    button.addEventListener('mouseleave', this.hideTooltip);
    button.addEventListener('blur', this.hideTooltip);
    this.button = button;
    return button;
  }

  /**
   * Show our tooltip above `button` the way the player shows its own: `.ytp-tooltip.ytp-bottom` inside the player,
   * centered over the button, PLAYER_TOOLTIP.GAP_PX above it, kept PLAYER_TOOLTIP.EDGE_PX inside the player.
   */
  private showTooltip(button: HTMLElement): void {
    const player = button.closest<HTMLElement>(SELECTORS.MOVIE_PLAYER);
    if (!player) return;
    const tooltip = this.tooltip ?? this.createTooltip();
    if (tooltip.parentElement !== player) player.appendChild(tooltip);
    tooltip.style.display = '';
    const playerBox = player.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const centered = buttonBox.left - playerBox.left + buttonBox.width / 2 - width / 2;
    const maxLeft = playerBox.width - width - PLAYER_TOOLTIP.EDGE_PX;
    const left = Math.max(PLAYER_TOOLTIP.EDGE_PX, Math.min(centered, maxLeft));
    const top = buttonBox.top - playerBox.top - tooltip.offsetHeight - PLAYER_TOOLTIP.GAP_PX;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  private hideTooltip = (): void => {
    if (this.tooltip) this.tooltip.style.display = 'none';
  };

  private createTooltip(): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = `ytp-tooltip ytp-bottom ${ENTRY_POINT_CLASSES.TOOLTIP}`;
    tooltip.setAttribute('data-layer', PLAYER_TOOLTIP.LAYER);
    // As YouTube's: the text wrapper is hidden from screen readers (the button has the label); `aria-hidden` on the
    // tooltip itself would make YouTube's CSS keep it transparent
    tooltip.setAttribute('aria-live', 'polite');
    tooltip.style.maxWidth = `${PLAYER_TOOLTIP.MAX_WIDTH_PX}px`;
    const wrapper = document.createElement('div');
    wrapper.className = 'ytp-tooltip-text-wrapper';
    wrapper.setAttribute('aria-hidden', 'true');
    const bottom = document.createElement('div');
    bottom.className = 'ytp-tooltip-bottom-text';
    const text = document.createElement('span');
    text.className = 'ytp-tooltip-text';
    text.textContent = this.i18n.t('PIP');
    // The key in YouTube's badge next to the text (`keyBoardShortcut` of the player's tooltip template)
    const shortcut = document.createElement('div');
    shortcut.className = 'ytp-tooltip-keyboard-shortcut';
    shortcut.textContent = PIP_HOTKEY.toUpperCase();
    bottom.append(text, shortcut);
    wrapper.appendChild(bottom);
    tooltip.appendChild(wrapper);
    this.tooltip = tooltip;
    return tooltip;
  }

  private createIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', PIP_ICON_PATH);
    path.setAttribute('fill', 'white');
    svg.appendChild(path);
    return svg;
  }

  private openPiP(source: string): void {
    this.logger.log(`Opening PiP from the ${source}`);
    this.pipManager.open().catch((e) => {
      this.logger.error(`Error opening PiP from the ${source}:`, e);
    });
  }
}
