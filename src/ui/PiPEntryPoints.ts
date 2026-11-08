import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PiPManager } from '../core/PiPManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import {
  ENTRY_POINT_CLASSES,
  ENTRY_POINT_LABELS,
  KEY_CODES,
  KEYS,
  PIP_ICON_PATH,
} from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';
import { inject, injectable } from '../di';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Extra ways to open our PiP from the page (experimental, Ukrainian labels only):
 * - an item at the top of the player's context menu (watch page and mini player), never in the PiP window;
 * - a button in the player controls next to the settings button (hidden in the PiP window by styles.css).
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
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('PiPEntryPoints');
  }

  public initialize(): void {
    document.addEventListener('contextmenu', this.onContextMenu, true);
    // The controls are shown on pointer movement over the player: a cheap check that our button is still there
    document.addEventListener('pointermove', this.ensureControlsButton, {
      capture: true,
      passive: true,
    });
    this.ensureControlsButton();
    this.logger.debug('PiP entry points initialized');
  }

  /** Remove the listeners and stop watching the menus (the added item and button stay). */
  public stop(): void {
    document.removeEventListener('contextmenu', this.onContextMenu, true);
    document.removeEventListener('pointermove', this.ensureControlsButton, true);
    this.menuObserver.disconnect();
  }

  /** Capture phase, before YouTube opens the menu: remember the target and watch the menus. */
  private onContextMenu = (e: MouseEvent): void => {
    this.lastContextTarget = e.target instanceof Element ? e.target : null;
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

  /** The item belongs to a shown menu of the page's watch / mini player while PiP is closed. */
  private wantsItem(menu: HTMLElement): boolean {
    return (
      this.pipWindowProvider.getWindow() === null &&
      menu.ownerDocument === document &&
      this.lastContextTarget?.closest(SELECTORS.MOVIE_PLAYER) != null &&
      this.lastContextTarget.ownerDocument === document
    );
  }

  private reconcileMenu(menu: HTMLElement): void {
    if (menu.style.display === 'none') return;
    const list = menu.querySelector<HTMLElement>(SELECTORS.PANEL_MENU);
    if (!list) return;
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
    label.textContent = ENTRY_POINT_LABELS.MENU_ITEM;
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

  /** Our button before the settings button of the page's player; re-added when YouTube rebuilt the controls. */
  private ensureControlsButton = (): void => {
    if (this.button?.isConnected) return;
    const settings = document.querySelector(
      `${SELECTORS.MOVIE_PLAYER} ${SELECTORS.SETTINGS_BUTTON}`
    );
    if (!settings?.parentElement) return;
    const button = this.button ?? this.createButton();
    settings.parentElement.insertBefore(button, settings);
    this.logger.debug('PiP button added to the player controls');
  };

  private createButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `ytp-button ${ENTRY_POINT_CLASSES.BUTTON}`;
    button.setAttribute('aria-label', ENTRY_POINT_LABELS.BUTTON);
    button.title = ENTRY_POINT_LABELS.BUTTON;
    button.appendChild(this.createIcon());
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPiP('controls button');
    });
    this.button = button;
    return button;
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
