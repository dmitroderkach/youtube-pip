# YouTube PiP

Smart Picture-in-Picture mode for YouTube with full playback controls and navigation.

## ✨ Features

### Core Functionality

- **🖼️ Document Picture-in-Picture** — Opens YouTube mini player in a separate, always-on-top window using Chrome's Document PiP API
- **🎮 Media Session Integration** — Trigger PiP directly from browser's native media controls (e.g., "Enter Picture-in-Picture" button)
- **🔄 SPA Navigation** — Click on video links inside PiP window to navigate without reloading the page

### Playback Controls

- **⏩ Seek Support** — Click or drag the progress bar in PiP window to jump to any point in the video
- **👍 Like/Dislike** — Fully functional like and dislike buttons in PiP window
- **📋 Context Menu** — Right-click menu works seamlessly between main window and PiP

### Smart Features

- **📊 Playlist Panel** — Automatic window height adjustment when playlist expands
- **📝 Title Sync** — Window titles stay synchronized between main page and PiP
- **▶️ State Preservation** — Playback position and playing state are preserved when closing PiP

## 📸 Screenshot

![YouTube PiP Window](https://raw.githubusercontent.com/dmitroderkach/youtube-pip/main/screenshots/pip-window.png)

## 🔧 Requirements

- **Browser:** Chrome or Chromium-based browser with [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/) support
- **Extension:** [Tampermonkey](https://www.tampermonkey.net/)

## 📥 Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the "Install" button on this page
3. Confirm installation in Tampermonkey
4. Open [YouTube](https://www.youtube.com/) and play any video

## 🐛 Debug Mode

Enable detailed logging in DevTools console:

```javascript
localStorage.setItem('YOUTUBE_PIP_DEBUG', 'true');
```

Then reload the page. Logs include timestamps and are scoped by module.

## 🔗 Links

- **GitHub Repository:** [dmitroderkach/youtube-pip](https://github.com/dmitroderkach/youtube-pip)
- **Changelog:** [CHANGELOG.md](https://github.com/dmitroderkach/youtube-pip/blob/main/CHANGELOG.md)
- **Report Issues:** [GitHub Issues](https://github.com/dmitroderkach/youtube-pip/issues)
- **Source Code:** [View on GitHub](https://github.com/dmitroderkach/youtube-pip)

## 📄 License

MIT License — Free to use, modify, and distribute.

## ⚠️ Disclaimer

This userscript is **not affiliated with, endorsed by, or officially connected to** Google LLC or YouTube. It is an independent, third-party tool. Use at your own risk. YouTube's site structure and APIs may change at any time.
