interface CollaborationLiveSyncClock {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

interface StartCollaborationLiveSyncOptions {
  intervalMs?: number;
  clock?: CollaborationLiveSyncClock;
}

export function startCollaborationLiveSync(
  refresh: () => void | Promise<void>,
  options: StartCollaborationLiveSyncOptions = {},
) {
  const clock = options.clock ?? {
    setInterval: (callback: () => void, intervalMs: number) =>
      window.setInterval(callback, intervalMs),
    clearInterval: (handle: unknown) => window.clearInterval(handle as number),
  };

  const intervalMs = options.intervalMs ?? 3000;
  void refresh();

  const timer = clock.setInterval(() => {
    void refresh();
  }, intervalMs);

  return () => {
    clock.clearInterval(timer);
  };
}
