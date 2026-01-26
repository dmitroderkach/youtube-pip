/**
 * CSS styles for PiP window fixes and customizations
 */
export const CSS_FIXES = `
        ytd-miniplayer {
            left: 0 !important;
            right: 0 !important;
            top: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-height: 100% !important;
            display: flex !important;
        }
        ytd-miniplayer-player-container {
            width: 100% !important;
            height: 100% !important;
        }
        .html5-video-container {
            position: absolute;
            top: 0; left: 0; bottom: 0; right: 0;
        }
        .html5-video-container .html5-main-video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain;
        }
        video {
            left: 0 !important;
            top: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
        }
        .ytDraggableComponentHost.ytdMiniplayerComponentDraggable {
            pointer-events: auto !important;
        }
        .ytp-miniplayer-expand-watch-page-button, .ytp-miniplayer-close-button, #header-contents, .ytdMiniplayerComponentResizers {
            display: none !important;
        }

        /* Stretch progress bar to full width */
        .ytp-progress-bar-container,
        .ytp-progress-bar {
            width: 100% !important;
        }

        .ytp-prev-button, .ytp-next-button {
            display: inline-flex !important;
        }
    `;
