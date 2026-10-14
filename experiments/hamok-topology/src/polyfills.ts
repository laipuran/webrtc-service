import { Buffer } from 'buffer';

// Only the globals used by the installed Hamok source, not a full Node runtime.
const globals = globalThis as unknown as {
  Buffer?: typeof Buffer;
  process?: { nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void };
};
globals.Buffer ??= Buffer;
globals.process ??= {
  nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
};
