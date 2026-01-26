import { Logger } from '../logger';
import { TIMEOUTS } from '../constants';
import type { DocumentOrElement, Nullable } from '../types/app';

const logger = Logger.getInstance('DOMUtils');

/**
 * Utility class for DOM operations
 */
export class DOMUtils {
  /**
   * Create a comment node to use as a placeholder (e.g. before moving an element elsewhere).
   */
  public static createPlaceholder(commentText: string): Comment {
    return document.createComment(commentText);
  }

  /**
   * Insert placeholder before element. Element stays in DOM; caller typically moves it.
   * @returns true if inserted, false if element has no parent
   */
  public static insertPlaceholderBefore(element: Node, placeholder: Comment): boolean {
    const parent = element.parentNode;
    if (!parent) {
      logger.warn('insertPlaceholderBefore: element has no parent');
      return false;
    }
    parent.insertBefore(placeholder, element);
    logger.debug('Placeholder inserted');
    return true;
  }

  /**
   * Restore element in place of placeholder, then remove placeholder.
   * Use after moving element back from another container.
   */
  public static restoreElementFromPlaceholder(element: Node, placeholder: Comment): void {
    const parent = placeholder.parentNode;
    if (!parent) {
      logger.warn('restoreElementFromPlaceholder: placeholder has no parent');
      return;
    }
    parent.insertBefore(element, placeholder);
    placeholder.remove();
    logger.debug('Element restored from placeholder');
  }

  /**
   * Copy all attributes from source element to target element
   */
  public static copyAttributes(source: Nullable<Element>, target: Nullable<Element>): void {
    if (!source || !target) {
      logger.warn('copyAttributes: source or target is null');
      return;
    }

    try {
      Array.from(source.attributes).forEach((attr) => {
        try {
          target.setAttribute(attr.nodeName, attr.nodeValue || '');
        } catch (e) {
          logger.warn(`Failed to copy attribute ${attr.nodeName}:`, e);
        }
      });
      logger.debug('Attributes copied successfully');
    } catch (e) {
      logger.error('Error copying attributes:', e);
    }
  }

  /**
   * Unwrap element by moving all children to parent and removing wrapper
   */
  public static unwrap(wrapper: Nullable<Element>): void {
    if (!wrapper) {
      logger.warn('unwrap: wrapper is null');
      return;
    }

    const parent = wrapper.parentNode;
    if (!parent) {
      logger.warn('unwrap: Element has no parent node');
      return;
    }

    try {
      // Move all child nodes before the wrapper
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }

      // Remove the now-empty wrapper
      parent.removeChild(wrapper);
      logger.debug('Element unwrapped successfully');
    } catch (e) {
      logger.error('Error unwrapping element:', e);
    }
  }

  /**
   * Wait for element to appear in DOM using selector
   * @param selector CSS selector
   * @param parent Parent element to search in (default: document)
   * @param timeout Timeout in milliseconds (0 = infinite)
   * @param targetWindow When timeout is 0, disconnect observer on this window's pagehide (e.g. PiP window)
   * @returns Promise that resolves with the found element
   */
  public static waitForElementSelector(
    selector: string,
    parent: DocumentOrElement = document,
    timeout: number = TIMEOUTS.ELEMENT_WAIT,
    targetWindow?: Window | null
  ): Promise<Element> {
    return new Promise((resolve, reject) => {
      // Check if element already exists
      const existing = parent.querySelector(selector);
      if (existing) {
        logger.debug(`Element found immediately: ${selector}`);
        return resolve(existing);
      }

      logger.debug(`Waiting for element: ${selector}`);

      // Create observer to watch for element
      const observer = new MutationObserver((_, obs) => {
        const element = parent.querySelector(selector);
        if (element) {
          logger.debug(`Element appeared: ${selector}`);
          obs.disconnect();
          resolve(element);
        }
      });

      // Observe the parent for changes
      const target = parent === document ? document.body : parent;
      if (!target) {
        reject(new Error(`Target element not found for selector: ${selector}`));
        return;
      }

      observer.observe(target, {
        childList: true,
        subtree: true,
      });

      // Set timeout if specified
      if (timeout > 0) {
        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout: ${selector} not found`));
        }, timeout);
      }

      // For infinite timeout: disconnect and reject when targetWindow fires pagehide (e.g. PiP closed)
      if (timeout === 0 && targetWindow && !targetWindow.closed) {
        targetWindow.addEventListener(
          'pagehide',
          () => {
            observer.disconnect();
            reject(new Error('Wait aborted: target window closed'));
          },
          { once: true }
        );
      }
    });
  }
}
