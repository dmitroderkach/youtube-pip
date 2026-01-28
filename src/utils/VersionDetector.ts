/**
 * Utility for detecting YouTube client version and script version
 */

/**
 * Get script version from Vite define (injected at build time)
 */
function getScriptVersion(): string {
  return typeof SCRIPT_VERSION !== 'undefined' ? SCRIPT_VERSION : 'unknown';
}

/**
 * Get YouTube client version from window.ytcfg
 */
function getYouTubeVersion(): string {
  try {
    const ytcfg = window.ytcfg;
    if (ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.clientVersion) {
      return ytcfg.data_.INNERTUBE_CONTEXT.client.clientVersion;
    }
  } catch {
    // Silently fail if version detection fails
  }

  return 'unknown';
}

/**
 * Get YouTube feature flags/experiments configuration from window.ytcfg
 */
function getYouTubeFeatureFlags(): Record<string, unknown> {
  try {
    const ytcfg = window.ytcfg;
    if (!ytcfg?.data_) {
      return {};
    }

    const data = ytcfg.data_ as Record<string, unknown>;

    // EXPERIMENT_FLAGS - feature flags location
    if ('EXPERIMENT_FLAGS' in data && data.EXPERIMENT_FLAGS) {
      return { experimentFlags: data.EXPERIMENT_FLAGS };
    }

    return {};
  } catch {
    // Silently fail if feature flags detection fails
  }

  return {};
}

/**
 * Extract browser name and version from navigator userAgent
 */
function getBrowserVersion(): string {
  try {
    const userAgent = navigator.userAgent;
    if (!userAgent) {
      return 'unknown';
    }

    // Chrome (check before Edge as Edge UA contains "Chrome")
    const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
    if (chromeMatch && !userAgent.includes('Edg/')) {
      return `Chrome/${chromeMatch[1]}`;
    }

    // Edge
    const edgeMatch = userAgent.match(/Edg\/([\d.]+)/);
    if (edgeMatch) {
      return `Edge/${edgeMatch[1]}`;
    }

    // Firefox
    const firefoxMatch = userAgent.match(/Firefox\/([\d.]+)/);
    if (firefoxMatch) {
      return `Firefox/${firefoxMatch[1]}`;
    }

    // Safari (check Version first, then Safari)
    const safariVersionMatch = userAgent.match(/Version\/([\d.]+).*Safari/);
    if (safariVersionMatch && !userAgent.includes('Chrome')) {
      return `Safari/${safariVersionMatch[1]}`;
    }

    // Fallback: return full user agent if no match
    return userAgent;
  } catch {
    // Silently fail if browser version detection fails
  }

  return 'unknown';
}

/**
 * Get global metadata object with YouTube, script, browser versions, and feature flags
 */
export function getGlobalMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    youtubeVersion: getYouTubeVersion(),
    scriptVersion: getScriptVersion(),
    browserVersion: getBrowserVersion(),
  };

  const featureFlags = getYouTubeFeatureFlags();
  if (Object.keys(featureFlags).length > 0) {
    metadata.youtubeFeatureFlags = featureFlags;
  }

  return metadata;
}
