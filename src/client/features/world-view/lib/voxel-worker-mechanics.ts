export type WorkerCheckpointPhase =
  | "before-allocation"
  | "optimized-decode"
  | "quad-writing"
  | "emissive-bake"
  | "before-transfer";

export type WorkerCheckpoint = (
  phase: WorkerCheckpointPhase,
  forceYield?: boolean,
) => Promise<void>;

type CancellableWorkerOutcome<T> =
  | { type: "committed"; value: T }
  | { type: "cancelled" };

class WorkerCancellation extends Error {}

export async function runCancellableWorkerTask<T>(args: {
  budgetMs: number;
  isCancelled: () => boolean;
  build: (checkpoint: WorkerCheckpoint) => Promise<T>;
  commit: (value: T) => void;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  onCheckpoint?: (phase: WorkerCheckpointPhase) => void;
}): Promise<CancellableWorkerOutcome<T>> {
  const now = args.now ?? (() => performance.now());
  const yieldControl =
    args.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let lastYieldAt = now();

  const checkpoint: WorkerCheckpoint = async (phase, forceYield = false) => {
    args.onCheckpoint?.(phase);
    if (args.isCancelled()) throw new WorkerCancellation();
    if (forceYield || now() - lastYieldAt >= args.budgetMs) {
      await yieldControl();
      lastYieldAt = now();
      if (args.isCancelled()) throw new WorkerCancellation();
    }
  };

  try {
    await checkpoint("before-allocation", true);
    const value = await args.build(checkpoint);
    await checkpoint("before-transfer", true);
    args.commit(value);
    return { type: "committed", value };
  } catch (error) {
    if (error instanceof WorkerCancellation) return { type: "cancelled" };
    throw error;
  }
}
