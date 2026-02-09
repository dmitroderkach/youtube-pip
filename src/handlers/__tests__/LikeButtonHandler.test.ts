import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow, createFakeMouseEvent } from '../../test-utils/test-helpers';
import { LikeButtonHandler } from '../LikeButtonHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { YtActionSender } from '../../core/YtActionSender';
import { YT_LIKE_ACTIONS } from '../../constants';
import { SELECTORS } from '../../selectors';

describe('LikeButtonHandler', () => {
  let likeHandler: LikeButtonHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockYtActionSender: MockProxy<YtActionSender>;
  let pipDoc: Document;
  let clickHandler: (e: MouseEvent) => void;

  beforeEach(() => {
    pipDoc = document.implementation.createHTMLDocument();
    vi.spyOn(pipDoc, 'addEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'click') clickHandler = listener as (e: MouseEvent) => void;
      }
    );
    const pipWindow = createFakeWindow({ document: pipDoc });

    mockPipProvider = mock<PipWindowProvider>();
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtActionSender = mock<YtActionSender>();

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(YtActionSender).toInstance(mockYtActionSender);
    c.bind(LikeButtonHandler).toSelf();
    likeHandler = c.get(LikeButtonHandler);
  });

  it('initialize adds click listener', () => {
    likeHandler.initialize();
    expect(clickHandler).toBeDefined();
  });

  it('cleanup sets pipWindow to null', () => {
    likeHandler.initialize();
    likeHandler.cleanup();
    expect(() => likeHandler.cleanup()).not.toThrow();
  });

  it('initialize when pip window null does not throw', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    expect(() => likeHandler.initialize()).not.toThrow();
  });

  function createLikeButtonDOM(ariaPressed: boolean, isLike: boolean) {
    const container = pipDoc.createElement('div');
    const likeToggle = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const dislikeToggle = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const button = pipDoc.createElement('button');
    button.className = SELECTORS.BUTTON_SHAPE.slice(1);
    button.setAttribute('aria-pressed', String(ariaPressed));
    (isLike ? likeToggle : dislikeToggle).appendChild(button);
    container.appendChild(likeToggle);
    container.appendChild(dislikeToggle);
    pipDoc.body.appendChild(container);
    return button;
  }

  it('click on like button (not pressed) sends LIKE', () => {
    likeHandler.initialize();
    const button = createLikeButtonDOM(false, true);
    clickHandler!(createFakeMouseEvent({ target: button }));
    expect(mockYtActionSender.sendLikeAction).toHaveBeenCalledWith(YT_LIKE_ACTIONS.LIKE);
  });

  it('click on like button (pressed) sends REMOVE', () => {
    likeHandler.initialize();
    const button = createLikeButtonDOM(true, true);
    clickHandler!(createFakeMouseEvent({ target: button }));
    expect(mockYtActionSender.sendLikeAction).toHaveBeenCalledWith(YT_LIKE_ACTIONS.REMOVE);
  });

  it('click on dislike button (not pressed) sends DISLIKE', () => {
    likeHandler.initialize();
    const button = createLikeButtonDOM(false, false);
    clickHandler!(createFakeMouseEvent({ target: button }));
    expect(mockYtActionSender.sendLikeAction).toHaveBeenCalledWith(YT_LIKE_ACTIONS.DISLIKE);
  });

  it('click outside like/dislike does not send', () => {
    likeHandler.initialize();
    const div = pipDoc.createElement('div');
    pipDoc.body.appendChild(div);
    clickHandler!(createFakeMouseEvent({ target: div }));
    expect(mockYtActionSender.sendLikeAction).not.toHaveBeenCalled();
  });

  it('click when toggle has no parentElement does not send', () => {
    likeHandler.initialize();
    const toggle = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    toggle.appendChild(pipDoc.createElement('button'));
    clickHandler!(createFakeMouseEvent({ target: toggle }));
    expect(mockYtActionSender.sendLikeAction).not.toHaveBeenCalled();
  });

  it('click when toggle is neither first nor second child does not send', () => {
    likeHandler.initialize();
    const container = pipDoc.createElement('div');
    const first = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const second = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const third = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const btn = pipDoc.createElement('button');
    btn.className = SELECTORS.BUTTON_SHAPE.slice(1);
    third.appendChild(btn);
    container.appendChild(first);
    container.appendChild(second);
    container.appendChild(third);
    pipDoc.body.appendChild(container);
    clickHandler!(createFakeMouseEvent({ target: btn }));
    expect(mockYtActionSender.sendLikeAction).not.toHaveBeenCalled();
  });

  it('click when closest button shape returns null does not send', () => {
    likeHandler.initialize();
    const toggle = pipDoc.createElement(SELECTORS.LIKE_BUTTON);
    const span = pipDoc.createElement('span');
    toggle.appendChild(span);
    pipDoc.body.appendChild(toggle);
    clickHandler!(createFakeMouseEvent({ target: span }));
    expect(mockYtActionSender.sendLikeAction).not.toHaveBeenCalled();
  });
});
