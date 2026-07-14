export type VoxelCoverageClass = "coverage" | "detail";
export type VoxelViewClass = "focus" | "forward" | "peripheral" | "rear";

export interface VoxelWorkPriority {
  coverageClass: VoxelCoverageClass;
  viewClass: VoxelViewClass;
  projectedBenefit: number;
  distance: number;
  lod: number;
  generation: number;
}

const COVERAGE_ORDER: Record<VoxelCoverageClass, number> = {
  coverage: 0,
  detail: 1,
};

const VIEW_ORDER: Record<VoxelViewClass, number> = {
  focus: 0,
  forward: 1,
  peripheral: 2,
  rear: 3,
};

export function compareVoxelWorkPriority(
  left: VoxelWorkPriority,
  right: VoxelWorkPriority,
): number {
  return (
    COVERAGE_ORDER[left.coverageClass] - COVERAGE_ORDER[right.coverageClass] ||
    VIEW_ORDER[left.viewClass] - VIEW_ORDER[right.viewClass] ||
    right.projectedBenefit - left.projectedBenefit ||
    left.distance - right.distance ||
    left.lod - right.lod ||
    right.generation - left.generation
  );
}

interface VoxelWorkIdentity {
  jobId: number;
  key: string;
  version: number;
}

type VoxelWorkStage =
  | "fetching"
  | "compact-input"
  | "meshing"
  | "expanded-output"
  | "inserted";

type VoxelWorkTerminalOutcome = "loaded" | "cancelled" | "discarded" | "error";

type VoxelWorkCancellationReason =
  | "demand-removed"
  | "refresh-superseded"
  | "shutdown";

interface VoxelStageLimits {
  maxJobs: number;
  maxBytes: number;
}

interface VoxelWorkTimestamps {
  selectedAt: number;
  fetchStartedAt?: number;
  fetchCompletedAt?: number;
  workerDispatchedAt?: number;
  workerStartedAt?: number;
  workerCompletedAt?: number;
  resultReceivedAt?: number;
  sceneInsertedAt?: number;
  firstVisibleAt?: number;
}

interface VoxelWorkTiming {
  fetchMs: number | null;
  compactQueueWaitMs: number | null;
  workerExecutionMs: number | null;
  resultTransferWaitMs: number | null;
  sceneQueueWaitMs: number | null;
  requestToVisibleMs: number | null;
}

interface VoxelTimingAggregate {
  sumMs: number;
  samples: number;
}

interface VoxelPipelineDiagnostics {
  timings: Record<keyof VoxelWorkTiming, VoxelTimingAggregate>;
  cancellations: Record<string, number>;
  discards: Record<string, number>;
}

function duration(start: number | undefined, end: number | undefined) {
  return start === undefined || end === undefined
    ? null
    : Math.max(0, end - start);
}

export function deriveVoxelWorkTiming(
  timestamps: VoxelWorkTimestamps,
): VoxelWorkTiming {
  return {
    fetchMs: duration(timestamps.fetchStartedAt, timestamps.fetchCompletedAt),
    compactQueueWaitMs: duration(
      timestamps.fetchCompletedAt,
      timestamps.workerDispatchedAt,
    ),
    workerExecutionMs: duration(
      timestamps.workerStartedAt,
      timestamps.workerCompletedAt,
    ),
    resultTransferWaitMs: duration(
      timestamps.workerCompletedAt,
      timestamps.resultReceivedAt,
    ),
    sceneQueueWaitMs: duration(
      timestamps.resultReceivedAt,
      timestamps.sceneInsertedAt,
    ),
    requestToVisibleMs: duration(
      timestamps.selectedAt,
      timestamps.firstVisibleAt,
    ),
  };
}

function createEmptyDiagnostics(): VoxelPipelineDiagnostics {
  const aggregate = (): VoxelTimingAggregate => ({ sumMs: 0, samples: 0 });
  return {
    timings: {
      fetchMs: aggregate(),
      compactQueueWaitMs: aggregate(),
      workerExecutionMs: aggregate(),
      resultTransferWaitMs: aggregate(),
      sceneQueueWaitMs: aggregate(),
      requestToVisibleMs: aggregate(),
    },
    cancellations: {},
    discards: {},
  };
}

interface VoxelWorkRecord<TCompact = ArrayBuffer, TExpanded = unknown>
  extends VoxelWorkIdentity {
  priority: VoxelWorkPriority;
  stage: VoxelWorkStage;
  compactBytes: number;
  expandedBytes: number;
  timestamps: VoxelWorkTimestamps;
  compact?: TCompact;
  expanded?: TExpanded;
  terminalOutcome?: VoxelWorkTerminalOutcome;
  cancellationReason?: VoxelWorkCancellationReason;
}

interface VoxelStageUsage {
  jobs: number;
  bytes: number;
}

interface VoxelSchedulerSnapshot {
  fetching: VoxelStageUsage;
  compactInput: VoxelStageUsage;
  activeWorker: VoxelStageUsage;
  expandedOutput: VoxelStageUsage;
}

function emptyUsage(): VoxelStageUsage {
  return { jobs: 0, bytes: 0 };
}

function hasCapacity(usage: VoxelStageUsage, limits: VoxelStageLimits) {
  if (usage.jobs === 0) return true;
  return usage.jobs < limits.maxJobs && usage.bytes < limits.maxBytes;
}

export class VoxelWorkScheduler<TCompact = ArrayBuffer, TExpanded = unknown> {
  readonly records = new Map<number, VoxelWorkRecord<TCompact, TExpanded>>();
  readonly terminalOutcomes = new Map<number, VoxelWorkTerminalOutcome>();
  readonly diagnostics = createEmptyDiagnostics();
  private nextJobId = 1;

  constructor(
    private compactLimits: VoxelStageLimits,
    private expandedLimits: VoxelStageLimits,
  ) {}

  setLimits(compact: VoxelStageLimits, expanded: VoxelStageLimits): void {
    this.compactLimits = compact;
    this.expandedLimits = expanded;
  }

  canStartFetch(): boolean {
    return hasCapacity(this.snapshot().compactInput, this.compactLimits);
  }

  getByKey(key: string): VoxelWorkRecord<TCompact, TExpanded>[] {
    return [...this.records.values()].filter((record) => record.key === key);
  }

  createFetching(input: {
    key: string;
    version: number;
    priority: VoxelWorkPriority;
    selectedAt: number;
    fetchStartedAt: number;
  }): VoxelWorkRecord<TCompact, TExpanded> {
    const record: VoxelWorkRecord<TCompact, TExpanded> = {
      jobId: this.nextJobId++,
      ...input,
      stage: "fetching",
      compactBytes: 0,
      expandedBytes: 0,
      timestamps: {
        selectedAt: input.selectedAt,
        fetchStartedAt: input.fetchStartedAt,
      },
    };
    this.records.set(record.jobId, record);
    return record;
  }

  acceptCompact(
    jobId: number,
    compact: TCompact,
    bytes: number,
    completedAt: number,
  ): boolean {
    const record = this.records.get(jobId);
    if (!record || record.stage !== "fetching") return false;
    record.stage = "compact-input";
    record.compact = compact;
    record.compactBytes = bytes;
    record.timestamps.fetchCompletedAt = completedAt;
    return true;
  }

  reprioritize(jobId: number, priority: VoxelWorkPriority): boolean {
    const record = this.records.get(jobId);
    if (!record || record.stage === "meshing") return false;
    record.priority = priority;
    return true;
  }

  dispatchNext(
    dispatchedAt: number,
  ): VoxelWorkRecord<TCompact, TExpanded> | null {
    const snapshot = this.snapshot();
    if (snapshot.activeWorker.jobs > 0) return null;
    if (!hasCapacity(snapshot.expandedOutput, this.expandedLimits)) return null;
    const next = [...this.records.values()]
      .filter((record) => record.stage === "compact-input")
      .sort((left, right) =>
        compareVoxelWorkPriority(left.priority, right.priority),
      )[0];
    if (!next) return null;
    next.stage = "meshing";
    next.timestamps.workerDispatchedAt = dispatchedAt;
    return next;
  }

  completeWorker(
    jobId: number,
    expanded: TExpanded,
    bytes: number,
    timing: {
      workerStartedAt: number;
      workerCompletedAt: number;
      resultReceivedAt: number;
    },
  ): boolean {
    const record = this.records.get(jobId);
    if (!record || record.stage !== "meshing" || record.cancellationReason) {
      return false;
    }
    record.stage = "expanded-output";
    record.compact = undefined;
    record.compactBytes = 0;
    record.expanded = expanded;
    record.expandedBytes = bytes;
    record.timestamps.workerStartedAt = timing.workerStartedAt;
    record.timestamps.workerCompletedAt = timing.workerCompletedAt;
    record.timestamps.resultReceivedAt = timing.resultReceivedAt;
    return true;
  }

  markSceneInserted(jobId: number, insertedAt: number): boolean {
    const record = this.records.get(jobId);
    if (!record || record.stage !== "expanded-output") return false;
    record.stage = "inserted";
    record.expanded = undefined;
    record.expandedBytes = 0;
    record.timestamps.sceneInsertedAt = insertedAt;
    return true;
  }

  markFirstVisible(jobId: number, visibleAt: number): boolean {
    const record = this.records.get(jobId);
    if (!record || record.stage !== "inserted") return false;
    record.timestamps.firstVisibleAt = visibleAt;
    return this.finish(jobId, "loaded");
  }

  finish(
    jobId: number,
    outcome: VoxelWorkTerminalOutcome,
    reason?: string,
  ): boolean {
    const record = this.records.get(jobId);
    if (!record || this.terminalOutcomes.has(jobId)) return false;
    record.terminalOutcome = outcome;
    this.recordDiagnostics(record, outcome, reason);
    this.terminalOutcomes.set(jobId, outcome);
    this.records.delete(jobId);
    return true;
  }

  private recordDiagnostics(
    record: VoxelWorkRecord<TCompact, TExpanded>,
    outcome: VoxelWorkTerminalOutcome,
    reason?: string,
  ): void {
    if (outcome === "loaded") {
      const timing = deriveVoxelWorkTiming(record.timestamps);
      for (const key of Object.keys(timing) as (keyof VoxelWorkTiming)[]) {
        const value = timing[key];
        if (value === null) continue;
        this.diagnostics.timings[key].sumMs += value;
        this.diagnostics.timings[key].samples++;
      }
      return;
    }
    const terminalReason = reason ?? record.cancellationReason ?? outcome;
    const key = `${record.stage}:${terminalReason}`;
    const counts =
      outcome === "cancelled"
        ? this.diagnostics.cancellations
        : this.diagnostics.discards;
    if (outcome === "cancelled" || outcome === "discarded") {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  cancelKey(
    key: string,
    reason: VoxelWorkCancellationReason,
    olderThanVersion = Number.POSITIVE_INFINITY,
  ): VoxelWorkRecord<TCompact, TExpanded>[] {
    const cancelled: VoxelWorkRecord<TCompact, TExpanded>[] = [];
    for (const record of this.records.values()) {
      if (record.key !== key || record.version >= olderThanVersion) continue;
      record.cancellationReason = reason;
      cancelled.push(record);
      if (record.stage !== "meshing") {
        this.finish(record.jobId, "cancelled", reason);
      }
    }
    return cancelled;
  }

  cancelAll(
    reason: VoxelWorkCancellationReason,
  ): VoxelWorkRecord<TCompact, TExpanded>[] {
    const cancelled: VoxelWorkRecord<TCompact, TExpanded>[] = [];
    for (const key of new Set(
      [...this.records.values()].map((record) => record.key),
    )) {
      cancelled.push(...this.cancelKey(key, reason));
    }
    return cancelled;
  }

  snapshot(): VoxelSchedulerSnapshot {
    const snapshot: VoxelSchedulerSnapshot = {
      fetching: emptyUsage(),
      compactInput: emptyUsage(),
      activeWorker: emptyUsage(),
      expandedOutput: emptyUsage(),
    };
    for (const record of this.records.values()) {
      const usage =
        record.stage === "fetching"
          ? snapshot.fetching
          : record.stage === "compact-input"
            ? snapshot.compactInput
            : record.stage === "meshing"
              ? snapshot.activeWorker
              : record.stage === "expanded-output"
                ? snapshot.expandedOutput
                : null;
      if (!usage) continue;
      usage.jobs += 1;
      usage.bytes +=
        record.stage === "compact-input" || record.stage === "meshing"
          ? record.compactBytes
          : record.stage === "expanded-output"
            ? record.expandedBytes
            : 0;
    }
    return snapshot;
  }
}
