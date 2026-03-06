# YouTube Internal API (Kevlar) Usage

This document describes how we interact with YouTube's internal Kevlar framework to implement Picture-in-Picture functionality.

> ⚠️ **Warning**: This API is undocumented, internal, and can break at any time. YouTube does not officially support external usage of these APIs.

---

## 📚 Table of Contents

- [What is Kevlar?](#what-is-kevlar)
- [Kevlar Components We Use](#kevlar-components-we-use)
- [Kevlar Event System](#kevlar-event-system)
- [Shorts: SET_SHORTS_LAYOUT dispatch](#shorts-set_shorts_layout-dispatch)
- [PiP Event Bridge](#pip-event-bridge)
- [Shorts lifecycle workaround](#shorts-lifecycle-workaround)
- [Kevlar Command System](#kevlar-command-system)
- [How We Discovered This API](#how-we-discovered-this-api)
- [Implementation Examples](#implementation-examples)
- [Risks and Limitations](#risks-and-limitations)

---

## What is Kevlar?

**Kevlar** is YouTube's internal JavaScript framework built on top of Polymer/Web Components. It handles:

- **Component rendering** - All `<ytd-*>` custom elements
- **State management** - Application state and data flow
- **Event bus** - Internal event system (`yt-action`, `yt-navigate`)
- **Command dispatcher** - Centralized command execution
- **SPA navigation** - Client-side routing

### Architecture

```
┌─────────────────────────────────────┐
│           ytd-app                   │  ← Root Kevlar component
│  ┌──────────────────────────────┐  │
│  │    Event Bus (fire)          │  │  ← Event system
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  Command System              │  │  ← Command dispatcher
│  │  (resolveCommand)            │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  State Management            │  │  ← Application state
│  │  (miniplayerIsActive, etc)   │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## Kevlar Components We Use

### 1. `ytd-app` - Root Application Component

**Purpose**: Main YouTube application element that controls all functionality.

**TypeScript Interface**:

```typescript
export interface YouTubeAppElement extends HTMLElement {
  // Event dispatcher - sends events through Kevlar event bus
  fire(eventName: YouTubeEventName, detail?: unknown): void;

  // Command dispatcher - executes YouTube commands (like, subscribe, etc)
  resolveCommand?(command: Partial<YouTubeCommand>): void;

  // State properties
  miniplayerIsActive: boolean;
}
```

**Selector**: `'ytd-app'`

**Usage in Code**:

```typescript
// src/core/YtActionSender.ts
const mainApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);
mainApp.resolveCommand({ likeEndpoint: { ... } });
```

---

### 2. `ytd-miniplayer` - Mini Player Component

**Purpose**: Container for YouTube's native mini player mode.

**Selector**: `'ytd-miniplayer'`

**Usage in Code**:

```typescript
// src/core/PiPManager.ts
const miniplayer = await DOMUtils.waitForElementSelector<MiniPlayerElement>(
  SELECTORS.MINIPLAYER_HOST,
  document
);
```

---

### 3. `#movie_player` - Video Player Wrapper

**Purpose**: Main video player instance with playback controls.

**TypeScript Interface**:

```typescript
export interface YouTubePlayer extends HTMLElement {
  // Player state
  getPlayerState?(): PlayerState;

  // Playback controls
  playVideo?(): void;
  pauseVideo?(): void;
  seekTo?(seconds: number, allowSeekAhead: boolean): void;

  // Video information
  getDuration?(): number;
  getCurrentTime?(): number;
  getVideoData?: () => VideoData;

  // Size management
  setInternalSize?(): void;
  setSize?(): void;
}
```

**Selector**: `'#movie_player'`

**Usage in Code**:

```typescript
// src/core/PlayerManager.ts
const player = document.querySelector<YouTubePlayer>(SELECTORS.MOVIE_PLAYER);
const state = player.getPlayerState();
```

---

### 4. `ytd-shorts` - Shorts Feed Component

**Purpose**: YouTube Shorts container. Used when moving the Shorts feed into Document PiP so the user can scroll reels in a floating window.

**TypeScript Interface** (`src/types/youtube.ts`):

```typescript
export interface YouTubeShortsElement extends HTMLElement {
  // Polymer-style action dispatch (internal state/layout)
  dispatch?(payload: unknown): void;

  // Nested player (same API as #movie_player)
  player?: YouTubePlayerAPI;

  // Returns aspect ratio string, e.g. "9:16"
  getAspectRatio?(): string;
}
```

**Selector**: `'ytd-shorts'`

**Usage in Code**:

```typescript
// src/core/PiPManager.ts – move Shorts to PiP
const shorts = document.querySelector<YouTubeShortsElement>(SELECTORS.YTD_SHORTS);
const aspectRatio = Number(shorts.getAspectRatio?.().split(': ')?.[1]);
// ... append to PiP document ...
shorts.dispatch({ payload: { shortsLayout: 0 }, type: 'SET_SHORTS_LAYOUT' });
```

---

## Kevlar Event System

### Event Bus: `ytdApp.fire()`

Kevlar uses a centralized event bus for internal communication.

#### Method Signature

```typescript
fire(eventName: YouTubeEventName, detail?: unknown): void
```

#### Event Types

**Defined in `src/constants.ts`**:

```typescript
export const YT_EVENTS = {
  ACTION: 'yt-action', // Execute YouTube action
  NAVIGATE: 'yt-navigate', // Navigate to different page
} as const;
```

---

### 1. `yt-action` Event

**Purpose**: Trigger YouTube actions (activate miniplayer, play, pause, etc.)

#### Event Structure

```typescript
{
  eventName: 'yt-action',
  detail: {
    actionName: string,        // Action identifier
    args: any[] | null,        // Action arguments
    optionalAction: boolean,   // Whether action is optional
    returnValue: any[],        // Expected return values
  }
}
```

#### Action Names

**Defined in `src/constants.ts`**:

```typescript
export const YT_ACTION_NAMES = {
  ACTIVATE_MINIPLAYER: 'yt-activate-miniplayer',
  ACTIVATE_MINIPLAYER_FROM_WATCH: 'yt-activate-miniplayer-from-watch-action',
} as const;
```

#### Example: Activate Mini Player

**Implementation in `src/ui/MiniPlayerController.ts`**:

```typescript
public activateMiniPlayer(): void {
  const ytdApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);

  ytdApp.fire(YT_EVENTS.ACTION, {
    actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER,
    args: [false],
    optionalAction: false,
    returnValue: [undefined],
  });
}
```

**What happens**:

1. Event dispatched to Kevlar event bus
2. Kevlar finds action handler for `yt-activate-miniplayer`
3. Mini player UI is activated
4. State `miniplayerIsActive` becomes `true`

---

### 2. `yt-navigate` Event

**Purpose**: Navigate to different YouTube pages (SPA navigation)

#### Event Structure

```typescript
{
  eventName: 'yt-navigate',
  detail: {
    endpoint: {
      watchEndpoint: {
        videoId: string,
        playlistId?: string | null,
        index?: number,
        params?: string,
        playerParams?: string,
      }
    }
  }
}
```

#### Example: Navigate to Full Player

**Implementation in `src/ui/MiniPlayerController.ts`**:

```typescript
public toggleMiniPlayer(): void {
  const ytdApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);
  const videoId = this.playerManager.getVideoId(document);

  if (ytdApp.miniplayerIsActive) {
    // Return to full player
    ytdApp.fire(YT_EVENTS.NAVIGATE, {
      endpoint: {
        watchEndpoint: { videoId },
      },
    });
  }
}
```

**What happens**:

1. Event dispatched to Kevlar event bus
2. Kevlar navigation handler processes endpoint
3. SPA navigates to watch page
4. Mini player is deactivated
5. Full player is shown

---

### 3. Offline video (download / remove): `yt-offline-video-endpoint`

Use `yt-action` with `actionName: 'yt-offline-video-endpoint'` to trigger offline video download or remove a video from offline storage.

#### Download video

```javascript
const ytdApp = document.querySelector('ytd-app');
ytdApp.fire('yt-action', {
  actionName: 'yt-offline-video-endpoint',
  args: [
    {
      offlineVideoEndpoint: {
        videoId: 'o_1aF54DO60',
        action: 'ACTION_ADD',
        actionParams: {
          formatType: 'SD',
          settingsAction: 'DOWNLOAD_QUALITY_SETTINGS_ACTION_ALREADY_SAVED',
        },
      },
    },
  ],
  optionalAction: true,
  returnValue: [undefined],
});
```

- **videoId** — Video ID.
- **action** — `"ACTION_ADD"` to download.
- **actionParams.formatType** — Quality, e.g. `"SD"`.
- **actionParams.settingsAction** — `"DOWNLOAD_QUALITY_SETTINGS_ACTION_ALREADY_SAVED"` (use saved quality settings).

#### Remove video from offline

```javascript
const ytdApp = document.querySelector('ytd-app');
ytdApp.fire('yt-action', {
  actionName: 'yt-offline-video-endpoint',
  args: [
    {
      offlineVideoEndpoint: {
        videoId: 'o_1aF54DO60',
        action: 'ACTION_REMOVE',
      },
    },
  ],
  optionalAction: true,
  returnValue: [undefined],
});
```

- **action** — `"ACTION_REMOVE"` to remove the offline copy.

---

## Shorts: SET_SHORTS_LAYOUT dispatch

**Purpose**: Switch the Shorts UI into “narrow” (mobile-style) layout so controls sit on the video instead of a wide desktop layout. Used when the Shorts feed is moved into the PiP window.

**Component**: `ytd-shorts` (see [ytd-shorts - Shorts Feed Component](#4-ytd-shorts---shorts-feed-component)).

**Method**: Polymer-style `dispatch()` on the `ytd-shorts` element.

**Payload**:

```typescript
shorts.dispatch({
  type: 'SET_SHORTS_LAYOUT',
  payload: { shortsLayout: 0 },
});
```

- **shortsLayout: 0** — Narrow layout (compact, mobile-like UI).
- Other values may exist for wide/desktop layouts (we only use `0` in PiP).

**Usage in Code** (`src/core/PiPManager.ts`):

After appending `ytd-shorts` to the PiP document, we call `dispatch` so the component re-renders in narrow mode. If `shorts.dispatch` is missing, we skip and log a warning.

---

## PiP Event Bridge

When Shorts (or the mini player) run inside the Document PiP window, the PiP document has its own DOM and its own `ytd-app` instance. Navigation and actions triggered inside PiP (e.g. link clicks, buttons) often emit internal custom events (`yt-navigate`, `yt-action`) on the PiP document. To keep the main tab in sync and to perform actions that must run in the main page (e.g. like via `resolveCommand`), we **bridge** those events from the PiP document to the **main window’s** `ytd-app`.

**Implementation**: `src/handlers/PiPEventBridgeHandler.ts`

- Listen on the **PiP window document** for `yt-navigate` and `yt-action` (custom events).
- On each event, call **main window** `ytdApp.fire(eventName, detail)` with the same `detail` so the main app performs the navigation or action.

```typescript
// PiP document fires; we forward to main window's ytd-app
const app = this.ytdAppProvider.getApp(); // main document
doc.addEventListener(YT_EVENTS.NAVIGATE, (e) => app.fire(YT_EVENTS.NAVIGATE, e.detail));
doc.addEventListener(YT_EVENTS.ACTION, (e) => app.fire(YT_EVENTS.ACTION, e.detail));
```

**Note**: `YtdAppProvider.getApp()` returns the main page’s `ytd-app`. The bridge does **not** target the PiP’s `ytd-app`; it forwards into the main page so that state, navigation, and commands (e.g. like) are applied there.

---

## Shorts lifecycle workaround

After moving `ytd-shorts` back from the PiP window to the main page, the Polymer component can misbehave:

1. **Render loop** — The component’s rendering can loop and keep the main thread busy.
2. **Stale metadata** — Reel metadata (title, author, etc.) may stop updating when switching to the next reel on the main page.

**Workaround**: Reinitialize the component’s lifecycle by briefly removing it from the DOM and restoring it when the tab is visible.

**Implementation**: `src/core/YtdShortsProvider.ts` — `reinitShortsLifeCycle()`

1. Subscribe to `document.visibilitychange`.
2. When `document.visibilityState === 'visible'`:
   - Insert a placeholder before the `ytd-shorts` element.
   - Call `shorts.remove()`.
   - In the next `requestAnimationFrame`, restore the element from the placeholder and, if it was playing, call `shorts.player?.playVideo?.()`.
3. Remove the `visibilitychange` listener after running once.

This runs only after the Shorts element has been moved back to the main page (e.g. in `returnShortsPlayerToMain` in PiPManager). Doing the remove/restore when the tab becomes active avoids the render loop and restores correct metadata updates. This is a **workaround** for internal Polymer lifecycle behavior, not a documented API.

---

## Kevlar Command System

### Command Dispatcher: `ytdApp.resolveCommand()`

Kevlar uses a command pattern for executing user actions.

#### Method Signature

```typescript
resolveCommand?(command: Partial<YouTubeCommand>): void
```

#### Command Registry Pattern

**Defined in `src/types/youtube.ts`**:

```typescript
// Registry of all command types
export interface YouTubeCommands {
  like: LikeCommand;
  // Future: subscribe, share, etc.
}

// Union type derived from registry
export type YouTubeCommand = YouTubeCommands[keyof YouTubeCommands];

// Like command structure
export interface LikeCommand {
  likeEndpoint: LikeEndpoint;
}

export interface LikeEndpoint {
  status: LikeActionType; // 'LIKE' | 'DISLIKE' | 'INDIFFERENT'
  target: {
    videoId: string;
  };
}
```

---

### Like/Dislike Commands

**Purpose**: Execute like, dislike, or remove rating actions.

#### Action Types

**Defined in `src/constants.ts`**:

```typescript
export const YT_LIKE_ACTIONS = {
  LIKE: 'LIKE', // Like video
  DISLIKE: 'DISLIKE', // Dislike video
  REMOVE: 'INDIFFERENT', // Remove rating
} as const;
```

#### Example: Send Like Action

**Implementation in `src/core/YtActionSender.ts`**:

```typescript
public sendLikeAction(actionType: LikeActionType): void {
  const videoId = this.playerManager.getVideoId(this.pipWindow.document);
  const mainApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);

  const command: YouTubeCommand = {
    likeEndpoint: {
      status: actionType,  // 'LIKE', 'DISLIKE', or 'INDIFFERENT'
      target: { videoId },
    },
  };

  mainApp.resolveCommand(command);
}
```

**What happens**:

1. Command sent to Kevlar command dispatcher
2. Kevlar validates command structure
3. Backend API call is made
4. UI is updated (button state, like count)

**Usage in `src/handlers/LikeButtonHandler.ts`**:

```typescript
// Detect button click
const isPressed = button.getAttribute('aria-pressed') === 'true';
const actionType = isPressed
  ? YT_LIKE_ACTIONS.REMOVE // Remove existing rating
  : isLikeButton
    ? YT_LIKE_ACTIONS.LIKE // Add like
    : YT_LIKE_ACTIONS.DISLIKE; // Add dislike

this.ytActionSender?.sendLikeAction(actionType);
```

---

### Add to playlist dialog: `addToPlaylistServiceEndpoint`

To open the "Save video to…" (Add to playlist) dialog, call `resolveCommand` with **addToPlaylistServiceEndpoint** and **videoId**:

```javascript
const ytdApp = document.querySelector('ytd-app');
ytdApp.resolveCommand({
  addToPlaylistServiceEndpoint: {
    videoId: 'dqKpx51vKLc',
  },
});
```

Building the object: only `addToPlaylistServiceEndpoint.videoId` is required — the video ID for which to open the dialog. YouTube fetches the rest (playlist list, endpoints, etc.) itself.

---

## How We Discovered This API

### 1. Chrome DevTools Inspection

#### Inspecting DOM Elements

```javascript
// In browser console:
const app = document.querySelector('ytd-app');
console.dir(app); // See all properties and methods
```

**Discovered**:

- `fire()` method
- `resolveCommand()` method
- `miniplayerIsActive` property

#### Event Monitoring

```javascript
// Monitor all events
monitorEvents(document.querySelector('ytd-app'));

// Click miniplayer button and observe:
// ► event: yt-action
//   detail: { actionName: "yt-activate-miniplayer", ... }
```

---

### 2. Network Tab Analysis

Monitor XHR/Fetch requests when clicking like button:

**Request Payload**:

```json
{
  "likeEndpoint": {
    "status": "LIKE",
    "target": {
      "videoId": "dQw4w9WgXcQ"
    }
  }
}
```

**Insight**: This matches the structure YouTube expects internally!

---

### 3. Source Code Analysis

Examining YouTube's minified JavaScript:

```javascript
// Found in YouTube source:
a.prototype.resolveCommand = function (command) {
  if (command.likeEndpoint) {
    this.sendLikeCommand(command.likeEndpoint);
  }
  // ... other commands
};
```

**Discovered**:

- Command structure
- Available commands
- Expected parameters

---

### 4. Trial and Error

Testing different command structures:

```typescript
// ✅ Works
ytdApp.fire('yt-action', {
  actionName: 'yt-activate-miniplayer',
  args: [false],
  optionalAction: false,
  returnValue: [undefined],
});

// ❌ Doesn't work (missing returnValue)
ytdApp.fire('yt-action', {
  actionName: 'yt-activate-miniplayer',
  args: [false],
});

// ❌ Doesn't work (wrong event name)
ytdApp.fire('activate-miniplayer', {});
```

---

## Implementation Examples

### Example 1: Complete Mini Player Toggle

**File**: `src/ui/MiniPlayerController.ts`

```typescript
public toggleMiniPlayer(): void {
  const ytdApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);

  if (!ytdApp || typeof ytdApp.fire !== 'function') {
    logger.error('ytd-app fire method not found');
    return;
  }

  try {
    if (ytdApp.miniplayerIsActive) {
      // Deactivate: Navigate to full watch page
      const videoId = this.playerManager.getVideoId(document);

      if (!videoId) {
        logger.error('Video ID not found, cannot navigate to full player');
        return;
      }

      ytdApp.fire(YT_EVENTS.NAVIGATE, {
        endpoint: {
          watchEndpoint: { videoId },
        },
      });

      logger.debug(`Navigation to full player dispatched for video ${videoId}`);
    } else {
      // Activate: Show mini player
      ytdApp.fire(YT_EVENTS.ACTION, {
        actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH,
        args: null,
        optionalAction: false,
        returnValue: [undefined],
      });

      logger.debug('Miniplayer activation event dispatched');
    }
  } catch (e) {
    logger.error('Error toggling mini player:', e);
  }
}
```

---

### Example 2: Like Button Handler

**File**: `src/handlers/LikeButtonHandler.ts`

```typescript
private setupClickHandler(): void {
  this.pipWindow.document.addEventListener('click', (event: MouseEvent) => {
    // Find like/dislike button
    const button = (event.target as Element)?.closest<HTMLButtonElement>(
      SELECTORS.BUTTON_SHAPE
    );

    if (!button) return;

    // Determine action type
    const isPressed = button.getAttribute('aria-pressed') === 'true';
    const isLikeButton = /* ... determine if like or dislike ... */;

    const actionType = isPressed
      ? YT_LIKE_ACTIONS.REMOVE
      : isLikeButton
        ? YT_LIKE_ACTIONS.LIKE
        : YT_LIKE_ACTIONS.DISLIKE;

    logger.log(`${actionType} button clicked`);

    // Send command through YtActionSender
    this.ytActionSender?.sendLikeAction(actionType);
  }, true);
}
```

**File**: `src/core/YtActionSender.ts`

```typescript
public sendLikeAction(actionType: LikeActionType): void {
  const videoId = this.playerManager.getVideoId(this.pipWindow.document);

  if (!videoId) {
    logger.error('Video ID not found, cannot send like action');
    return;
  }

  const mainApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);

  if (!mainApp || typeof mainApp.resolveCommand !== 'function') {
    logger.error('Failed to find resolveCommand in main window');
    return;
  }

  const command: YouTubeCommand = {
    likeEndpoint: {
      status: actionType,
      target: { videoId },
    },
  };

  try {
    mainApp.resolveCommand(command);
    logger.log(`Sent ${actionType} for video ${videoId}`);
  } catch (e) {
    logger.error('Error sending YouTube action:', e);
  }
}
```

---

### Example 3: SPA Navigation

**File**: `src/core/NavigationHandler.ts`

```typescript
private setupClickHandler(): void {
  this.pipWindow.document.addEventListener('click', (event: MouseEvent) => {
    const endpoint = (event.target as Element)?.closest<HTMLAnchorElement>(
      SELECTORS.SIMPLE_ENDPOINT
    );

    if (!endpoint) return;

    const href = endpoint.href;

    if (!href) {
      logger.warn('Navigation endpoint has no href');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      const url = new URL(href);
      const params = Object.fromEntries(url.searchParams);

      // Build Kevlar navigation state
      const state: NavigationState = {
        endpoint: {
          commandMetadata: {
            webCommandMetadata: {
              url: href,
              webPageType: WEB_PAGE_TYPES.WATCH,
              rootVe: ROOT_VE,
            },
          },
          watchEndpoint: {
            videoId: params.v,
            playlistId: params.list || null,
            index: params.index ? parseInt(params.index) - 1 : 0,
            params: 'OAE%3D',
            playerParams: params.pp,
          },
        },
        entryTime: performance.now(),
      };

      logger.log(`SPA navigation via ${YT_EVENTS.NAVIGATE}: ${href}`);

      // Trigger navigation
      window.dispatchEvent(new PopStateEvent('popstate', { state }));
    } catch (e) {
      logger.error('Error handling navigation:', e);
    }
  }, true);
}
```

---

## Risks and Limitations

### ⚠️ Breaking Changes

**Risk**: YouTube can change internal API at any time.

**Impact**:

- Methods removed/renamed
- Event structure changed
- Command format changed

**Mitigation**:

- Type guards for method availability
- Comprehensive error logging
- Graceful degradation

**Example**:

```typescript
if (!mainApp || typeof mainApp.resolveCommand !== 'function') {
  logger.error('Failed to find resolveCommand in main window');
  return;
}
```

---

### 🔒 Undocumented API

**Risk**: No official documentation or support.

**Impact**:

- Must reverse-engineer everything
- No guarantees of stability
- Behavior can change without notice

**Mitigation**:

- Extensive testing
- Monitor YouTube updates
- Community knowledge sharing

---

### 🐛 Partial Type Safety

**Risk**: We don't know all possible values/types.

**Impact**:

- Incomplete TypeScript definitions
- Runtime errors possible

**Mitigation**:

- Use `Partial<>` for optional fields
- Type guards everywhere
- Defensive programming

**Example**:

```typescript
export interface YouTubeAppElement extends HTMLElement {
  // Optional - might not exist
  resolveCommand?(command: Partial<YouTubeCommand>): void;
}
```

---

### 📱 Platform Differences

**Risk**: API behavior varies across platforms.

**Impact**:

- Desktop vs mobile differences
- Browser compatibility issues

**Mitigation**:

- Test on multiple platforms
- Feature detection

---

### 🔐 Security Considerations

**Risk**: Using internal APIs can expose security issues.

**Impact**:

- Potential XSS vectors
- Privacy concerns

**Mitigation**:

- Never modify YouTube's internal objects
- Read-only access when possible
- Validate all user input

---

## Best Practices

### 1. Always Check Method Availability

```typescript
if (typeof player.playVideo === 'function') {
  player.playVideo();
} else {
  logger.error('player.playVideo method not found');
}
```

---

### 2. Use Type Guards

```typescript
const mainApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);

if (!mainApp || typeof mainApp.fire !== 'function') {
  logger.error('ytd-app fire method not found');
  return;
}
```

---

### 3. Comprehensive Error Handling

```typescript
try {
  ytdApp.fire(YT_EVENTS.ACTION, { ... });
  logger.debug('Action dispatched');
} catch (e) {
  logger.error('Error dispatching action:', e);
}
```

---

### 4. Fallback Strategies

```typescript
// Try native API first
if (typeof ytdApp.fire === 'function') {
  ytdApp.fire('yt-action', { ... });
} else {
  // Fallback to keyboard simulation
  this.simulateKeyPress('i');
}
```

---

### 5. Extensive Logging

```typescript
logger.log(`Sent ${actionType} for video ${videoId}`);
logger.debug('Mini player activation event dispatched');
logger.error('Failed to find resolveCommand in main window');
logger.warn('Navigation endpoint has no href');
```

---

## Updating This Documentation

When YouTube updates their internal API:

1. **Test existing functionality** - does it still work?
2. **Check DevTools** - inspect `ytd-app` for changes
3. **Monitor events** - use `monitorEvents()` to see new event structures
4. **Update types** - add new methods/properties to TypeScript interfaces
5. **Update constants** - add new action names/event types
6. **Update this doc** - document new discoveries

---

## Additional Resources

### Internal Project Files

- **Type Definitions**: `src/types/youtube.ts` (includes `YouTubeShortsElement`, `YouTubeAppElement`, `YouTubePlayer`)
- **Constants**: `src/constants.ts`
- **Selectors**: `src/selectors.ts`
- **Mini Player Controller**: `src/ui/MiniPlayerController.ts`
- **Action Sender**: `src/core/YtActionSender.ts`
- **Navigation Handler**: `src/core/NavigationHandler.ts`
- **PiP Manager**: `src/core/PiPManager.ts` (Shorts move to PiP, `SET_SHORTS_LAYOUT`, return flow)
- **Shorts Provider**: `src/core/YtdShortsProvider.ts` (reinit lifecycle workaround, engagement panel)
- **PiP Event Bridge**: `src/handlers/PiPEventBridgeHandler.ts` (forward `yt-navigate` / `yt-action` from PiP to main app)

### External Resources

- **Web Components**: [MDN Web Components](https://developer.mozilla.org/en-US/docs/Web/Web_Components)
- **Polymer**: [Polymer Project](https://polymer-library.polymer-project.org/)
- **Chrome DevTools**: [Event Monitoring](https://developers.google.com/web/tools/chrome-devtools/console/events)

---

## Contributing

If you discover new YouTube internal APIs or behaviors:

1. Document the discovery process
2. Create TypeScript interfaces
3. Add constants to `src/constants.ts`
4. Update this documentation
5. Add implementation examples

---

**Last Updated**: 2026-03-06  
**Maintainer**: @dmitroderkach
