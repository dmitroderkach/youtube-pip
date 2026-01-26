import { CSS_FIXES } from '../styles';
import { Logger } from '../logger';
import { SELECTORS } from '../selectors';

const logger = Logger.getInstance('StyleUtils');

/**
 * Utility class for style and CSS operations
 */
export class StyleUtils {
  /**
   * Copy all stylesheets from source document to target document
   */
  public static copyStyles(sourceDoc: Document, targetDoc: Document): void {
    try {
      const styles = sourceDoc.querySelectorAll(SELECTORS.STYLESHEETS);
      logger.debug(`Copying ${styles.length} style elements`);

      styles.forEach((node) => {
        try {
          targetDoc.head.appendChild(node.cloneNode(true));
        } catch (e) {
          logger.warn('Failed to copy style node:', e);
        }
      });

      logger.debug('Styles copied successfully');
    } catch (e) {
      logger.error('Error copying styles:', e);
    }
  }

  /**
   * Inject CSS fixes into target document
   */
  public static injectCSSFixes(targetDoc: Document): void {
    try {
      const styleFix = targetDoc.createElement('style');
      styleFix.textContent = CSS_FIXES;
      targetDoc.head.appendChild(styleFix);
      logger.debug('CSS fixes injected successfully');
    } catch (e) {
      logger.error('Error injecting CSS fixes:', e);
    }
  }
}
