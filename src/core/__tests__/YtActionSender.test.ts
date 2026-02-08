import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { YtActionSender } from '../YtActionSender';
import { PipWindowProvider } from '../PipWindowProvider';
import { PlayerManager } from '../PlayerManager';
import { YtdAppProvider } from '../YtdAppProvider';
import { createTestContainer } from '../../test-utils/test-container';

describe('YtActionSender', () => {
  let sender: YtActionSender;
  let mockPip: MockProxy<PipWindowProvider>;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockYtdApp: MockProxy<YtdAppProvider>;
  let mockResolveCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPip = mock<PipWindowProvider>();
    mockPlayerManager = mock<PlayerManager>();
    mockYtdApp = mock<YtdAppProvider>();
    mockResolveCommand = vi.fn();

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPip);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(YtdAppProvider).toInstance(mockYtdApp);
    sender = c.get(YtActionSender);
  });

  it('sendLikeAction calls resolveCommand with like endpoint', () => {
    mockPip.getWindow.mockReturnValue(window);
    mockPlayerManager.getVideoId.mockReturnValue('vid1');
    mockYtdApp.getApp.mockReturnValue({
      resolveCommand: mockResolveCommand,
    } as unknown as ReturnType<YtdAppProvider['getApp']>);

    sender.sendLikeAction('LIKE');

    expect(mockResolveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        likeEndpoint: expect.objectContaining({
          status: 'LIKE',
          target: { videoId: 'vid1' },
        }),
      })
    );
  });

  it('sendLikeAction does nothing when pip window is null', () => {
    mockPip.getWindow.mockReturnValue(null);

    sender.sendLikeAction('DISLIKE');

    expect(mockResolveCommand).not.toHaveBeenCalled();
  });

  it('sendLikeAction does nothing when videoId is null', () => {
    mockPip.getWindow.mockReturnValue(window);
    mockPlayerManager.getVideoId.mockReturnValue(null);

    sender.sendLikeAction('LIKE');

    expect(mockResolveCommand).not.toHaveBeenCalled();
  });

  it('sendLikeAction does nothing when resolveCommand is not function', () => {
    mockPip.getWindow.mockReturnValue(window);
    mockPlayerManager.getVideoId.mockReturnValue('v1');
    mockYtdApp.getApp.mockReturnValue({} as unknown as ReturnType<YtdAppProvider['getApp']>);

    sender.sendLikeAction('LIKE');

    expect(mockResolveCommand).not.toHaveBeenCalled();
  });

  it('sendLikeAction logs error when resolveCommand throws', () => {
    mockPip.getWindow.mockReturnValue(window);
    mockPlayerManager.getVideoId.mockReturnValue('v1');
    mockResolveCommand.mockImplementation(() => {
      throw new Error('resolve failed');
    });
    mockYtdApp.getApp.mockReturnValue({
      resolveCommand: mockResolveCommand,
    } as unknown as ReturnType<YtdAppProvider['getApp']>);

    expect(() => sender.sendLikeAction('LIKE')).not.toThrow();
  });
});
