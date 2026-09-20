import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TypingManager,
  TYPING_TTL_MS,
} from '../src/websocket/typing-manager.ts';

describe('typing leases', () => {
  afterEach(() => vi.useRealTimers());
  const user = { connectionId: 'one', username: 'Nathan' };

  it('broadcasts only transitions, renews the lease, and expires silent typists', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const manager = new TypingManager(publish);
    manager.start('general', user);
    vi.advanceTimersByTime(3000);
    manager.start('general', user);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TYPING_TTL_MS - 3000);
    expect(publish).toHaveBeenLastCalledWith(
      'general',
      { type: 'typing_stop', payload: { roomId: 'general', user } },
      'one',
    );
    expect(publish).toHaveBeenCalledTimes(2);
    manager.close();
  });
  it('cleans all rooms on disconnect and cancels timers on shutdown', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const manager = new TypingManager(publish);
    manager.start('general', user);
    manager.start('developers', user);
    manager.remove('one');
    manager.remove('one');
    expect(publish).toHaveBeenCalledTimes(4);
    manager.start('general', user);
    manager.close();
    vi.runAllTimers();
    expect(publish).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
