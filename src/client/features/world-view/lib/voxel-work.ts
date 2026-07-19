export type VoxelCoverageClass = "coverage" | "detail";
export type VoxelViewClass = "focus" | "forward" | "peripheral" | "rear";
export type VoxelWorkPhase = "base" | "enhancement";
export type VoxelSafetyClass = "visible-hole" | "coverage" | "optional";

export interface VoxelWorkPriority {
  coverageClass: VoxelCoverageClass;
  safetyClass: VoxelSafetyClass;
  viewClass: VoxelViewClass;
  phase: VoxelWorkPhase;
  projectedBenefit: number;
  distance: number;
  lod: number;
  generation: number;
  demandSince: number;
  sequence: number;
}

const VIEW_ORDER: Record<VoxelViewClass, number> = {
  focus: 0,
  forward: 1,
  peripheral: 2,
  rear: 3,
};

const PHASE_ORDER: Record<VoxelWorkPhase, number> = {
  base: 0,
  enhancement: 1,
};

interface VoxelUrgencyConfig {
  focusDeadlineMs: number;
  deadlinePromotionSlackMs: number;
  maxAgingMs: number;
}

const DEFAULT_VOXEL_URGENCY_CONFIG: VoxelUrgencyConfig = {
  focusDeadlineMs: 2_500,
  deadlinePromotionSlackMs: 500,
  maxAgingMs: 10_000,
};

export function getVoxelSafetyClass(
  coverageClass: VoxelCoverageClass,
  viewClass: VoxelViewClass,
): VoxelSafetyClass {
  if (coverageClass === "detail") return "optional";
  return viewClass === "rear" ? "coverage" : "visible-hole";
}

function cappedDemandAge(
  priority: VoxelWorkPriority,
  now: number,
  config: VoxelUrgencyConfig,
): number {
  return Math.min(config.maxAgingMs, Math.max(0, now - priority.demandSince));
}

function isDeadlinePromoted(
  priority: VoxelWorkPriority,
  age: number,
  config: VoxelUrgencyConfig,
): boolean {
  return (
    priority.phase === "base" &&
    priority.viewClass === "focus" &&
    age >= config.focusDeadlineMs - config.deadlinePromotionSlackMs
  );
}

function urgencyBand(
  priority: VoxelWorkPriority,
  age: number,
  config: VoxelUrgencyConfig,
): number {
  if (priority.safetyClass === "visible-hole") return 0;
  if (isDeadlinePromoted(priority, age, config)) return 1;
  return priority.safetyClass === "coverage" ? 2 : 3;
}

export function compareVoxelWorkPriority(
  left: VoxelWorkPriority,
  right: VoxelWorkPriority,
  now = 0,
  config: VoxelUrgencyConfig = DEFAULT_VOXEL_URGENCY_CONFIG,
): number {
  const leftAge = cappedDemandAge(left, now, config);
  const rightAge = cappedDemandAge(right, now, config);
  return (
    urgencyBand(left, leftAge, config) - urgencyBand(right, rightAge, config) ||
    VIEW_ORDER[left.viewClass] - VIEW_ORDER[right.viewClass] ||
    PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] ||
    rightAge - leftAge ||
    right.projectedBenefit - left.projectedBenefit ||
    left.distance - right.distance ||
    left.lod - right.lod ||
    left.sequence - right.sequence
  );
}

export function findMostUrgentVoxelWorkIndex<T>(
  items: readonly T[],
  getPriority: (item: T) => VoxelWorkPriority,
  now: number,
  config: VoxelUrgencyConfig = DEFAULT_VOXEL_URGENCY_CONFIG,
): number {
  let bestIndex = -1;
  for (let index = 0; index < items.length; index++) {
    if (
      bestIndex === -1 ||
      compareVoxelWorkPriority(
        getPriority(items[index] as T),
        getPriority(items[bestIndex] as T),
        now,
        config,
      ) < 0
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

interface VoxelWorkIdentity {
  jobId: number;
  key: string;
  version: number;
  phase: VoxelWorkPhase;
}

type VoxelWorkStage =
  | "selected"
  | "fetch-queued"
  | "fetching"
  | "compact-input"
  | "retained-enhancement-input"
  | "meshing"
  | "expanded-output"
  | "inserted"
  | "fresh"
  | "known-missing"
  | "retry-exhausted"
  | "retry-delayed";

type VoxelDemandState =
  | "executable"
  | "fresh"
  | "known-missing"
  | "retry-exhausted"
  | "retry-delayed";

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
  enhancedAt?: number;
}

interface VoxelWorkTiming {
  selectionToFetchStartMs: number | null;
  fetchMs: number | null;
  compactQueueWaitMs: number | null;
  baseWorkerExecutionMs: number | null;
  resultTransferWaitMs: number | null;
  sceneQueueWaitMs: number | null;
  selectionToBaseVisibleMs: number | null;
  enhancementQueueWaitMs: number | null;
  enhancementWorkerExecutionMs: number | null;
  enhancementResultTransferWaitMs: number | null;
  enhancementAttachWaitMs: number | null;
  selectionToEnhancedMs: number | null;
}

interface VoxelTimingDistribution {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

interface VoxelObservationDistribution {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarizeVoxelTimingSamples(
  samples: readonly (number | null)[],
  limit = 256,
): VoxelTimingDistribution {
  const values = samples
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    )
    .slice(-Math.max(1, limit))
    .map((value) => Math.max(0, value))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const percentile = (value: number) =>
    values[Math.ceil(value * values.length) - 1] ?? null;
  return {
    count: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: values[values.length - 1] ?? null,
  };
}

interface VoxelPipelineDiagnostics {
  loadGeneration: number;
  timings: Record<keyof VoxelWorkTiming, VoxelTimingDistribution>;
  currentQueue: {
    jobs: number;
    executableStages: Record<string, VoxelStageUsage>;
    nonExecutableDemand: Record<
      Exclude<VoxelDemandState, "executable">,
      number
    >;
    oldestDemandAgeMs: {
      overall: number | null;
      byLod: Record<string, number>;
      bySafetyClass: Record<string, number>;
      byCoverageClass: Record<string, number>;
      byViewClass: Record<string, number>;
      byPhase: Record<string, number>;
    };
  };
  focusDeadlineMisses: number;
  sceneBacklog: VoxelStageUsage;
  observations: {
    frameTimeMs: VoxelObservationDistribution;
    workerBusyRatio: VoxelObservationDistribution;
    workerDurationMs: VoxelObservationDistribution;
    reservedExpandedBytes: VoxelObservationDistribution;
    activeWorkers: VoxelObservationDistribution;
    targetWorkers: VoxelObservationDistribution;
  };
  cancellations: Record<string, number>;
  discards: Record<string, number>;
}

class BoundedTimingDistribution {
  private readonly values: number[] = [];

  constructor(private readonly limit: number) {}

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.values.push(Math.max(0, value));
    if (this.values.length > this.limit) this.values.shift();
  }

  snapshot(): VoxelTimingDistribution {
    return summarizeVoxelTimingSamples(this.values, this.limit);
  }

  observationSnapshot(): VoxelObservationDistribution {
    const { count, p50Ms, p95Ms, maxMs } = this.snapshot();
    return { count, p50: p50Ms, p95: p95Ms, max: maxMs };
  }
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
    selectionToFetchStartMs: duration(
      timestamps.selectedAt,
      timestamps.fetchStartedAt,
    ),
    fetchMs: duration(timestamps.fetchStartedAt, timestamps.fetchCompletedAt),
    compactQueueWaitMs: duration(
      timestamps.fetchCompletedAt,
      timestamps.workerDispatchedAt,
    ),
    baseWorkerExecutionMs: duration(
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
    selectionToBaseVisibleMs: duration(
      timestamps.selectedAt,
      timestamps.firstVisibleAt,
    ),
    enhancementQueueWaitMs: duration(
      timestamps.fetchCompletedAt,
      timestamps.workerDispatchedAt,
    ),
    enhancementWorkerExecutionMs: duration(
      timestamps.workerStartedAt,
      timestamps.workerCompletedAt,
    ),
    enhancementResultTransferWaitMs: duration(
      timestamps.workerCompletedAt,
      timestamps.resultReceivedAt,
    ),
    enhancementAttachWaitMs: duration(
      timestamps.resultReceivedAt,
      timestamps.enhancedAt,
    ),
    selectionToEnhancedMs: duration(
      timestamps.selectedAt,
      timestamps.enhancedAt,
    ),
  };
}

function createTimingDistributions(limit: number) {
  const distribution = () => new BoundedTimingDistribution(limit);
  return {
    selectionToFetchStartMs: distribution(),
    fetchMs: distribution(),
    compactQueueWaitMs: distribution(),
    baseWorkerExecutionMs: distribution(),
    resultTransferWaitMs: distribution(),
    sceneQueueWaitMs: distribution(),
    selectionToBaseVisibleMs: distribution(),
    enhancementQueueWaitMs: distribution(),
    enhancementWorkerExecutionMs: distribution(),
    enhancementResultTransferWaitMs: distribution(),
    enhancementAttachWaitMs: distribution(),
    selectionToEnhancedMs: distribution(),
  } satisfies Record<keyof VoxelWorkTiming, BoundedTimingDistribution>;
}

function createObservationDistributions(limit: number) {
  const distribution = () => new BoundedTimingDistribution(limit);
  return {
    frameTimeMs: distribution(),
    workerBusyRatio: distribution(),
    workerDurationMs: distribution(),
    reservedExpandedBytes: distribution(),
    activeWorkers: distribution(),
    targetWorkers: distribution(),
  };
}

interface VoxelWorkRecord<TCompact = ArrayBuffer, TExpanded = unknown>
  extends VoxelWorkIdentity {
  loadGeneration: number;
  priority: VoxelWorkPriority;
  stage: VoxelWorkStage;
  compactBytes: number;
  expandedBytes: number;
  reservedExpandedBytes: number;
  workerId: number | null;
  baseMeshId: number | null;
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

interface VoxelDemandIdentity {
  version: number;
  demandSince: number;
  sequence: number;
  priority: VoxelWorkPriority;
}

interface VoxelSchedulerSnapshot {
  selected: VoxelStageUsage;
  fetchQueued: VoxelStageUsage;
  fetching: VoxelStageUsage;
  compactInput: VoxelStageUsage;
  retainedEnhancementInput: VoxelStageUsage;
  totalCompactInput: VoxelStageUsage;
  activeWorker: VoxelStageUsage;
  reservedExpandedOutput: VoxelStageUsage;
  expandedOutput: VoxelStageUsage;
}

interface VoxelExecutableBasePressure {
  jobs: number;
  oldestAgeMs: number;
}

interface VoxelRetainedEnhancementLimits extends VoxelStageLimits {
  highWaterJobs: number;
  highWaterBytes: number;
  lowWaterJobs: number;
  lowWaterBytes: number;
}

const DEFAULT_RETAINED_ENHANCEMENT_LIMITS: VoxelRetainedEnhancementLimits = {
  maxJobs: 16,
  maxBytes: 128 * 1024 * 1024,
  highWaterJobs: 12,
  highWaterBytes: 96 * 1024 * 1024,
  lowWaterJobs: 8,
  lowWaterBytes: 64 * 1024 * 1024,
};

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
  private loadGeneration = 1;
  private timingDistributions: ReturnType<typeof createTimingDistributions>;
  private observationDistributions: ReturnType<
    typeof createObservationDistributions
  >;
  private readonly cumulativeCancellations: Record<string, number> = {};
  private readonly cumulativeDiscards: Record<string, number> = {};
  private currentFocusDeadlineMisses = 0;
  private nextJobId = 1;
  private nextSequence = 1;
  private readonly demandIdentities = new Map<string, VoxelDemandIdentity>();
  private retainedEnhancementLimits: VoxelRetainedEnhancementLimits;

  constructor(
    private compactLimits: VoxelStageLimits,
    private expandedLimits: VoxelStageLimits,
    private readonly diagnosticSampleLimit = 256,
    retainedEnhancementLimits: Partial<VoxelRetainedEnhancementLimits> = {},
  ) {
    this.retainedEnhancementLimits = {
      ...DEFAULT_RETAINED_ENHANCEMENT_LIMITS,
      ...retainedEnhancementLimits,
    };
    this.timingDistributions = createTimingDistributions(
      Math.max(1, diagnosticSampleLimit),
    );
    this.observationDistributions = createObservationDistributions(
      Math.max(1, diagnosticSampleLimit),
    );
  }

  getDiagnostics(now: number): VoxelPipelineDiagnostics {
    const snapshot = this.snapshot();
    return {
      loadGeneration: this.loadGeneration,
      timings: Object.fromEntries(
        Object.entries(this.timingDistributions).map(([key, distribution]) => [
          key,
          distribution.snapshot(),
        ]),
      ) as Record<keyof VoxelWorkTiming, VoxelTimingDistribution>,
      currentQueue: this.getCurrentQueueDiagnostics(now),
      focusDeadlineMisses: this.currentFocusDeadlineMisses,
      sceneBacklog: snapshot.expandedOutput,
      observations: Object.fromEntries(
        Object.entries(this.observationDistributions).map(
          ([key, distribution]) => [key, distribution.observationSnapshot()],
        ),
      ) as VoxelPipelineDiagnostics["observations"],
      cancellations: { ...this.cumulativeCancellations },
      discards: { ...this.cumulativeDiscards },
    };
  }

  get diagnostics(): VoxelPipelineDiagnostics {
    return this.getDiagnostics(0);
  }

  resetLoadGeneration(): number {
    this.loadGeneration++;
    this.timingDistributions = createTimingDistributions(
      Math.max(1, this.diagnosticSampleLimit),
    );
    this.observationDistributions = createObservationDistributions(
      Math.max(1, this.diagnosticSampleLimit),
    );
    this.currentFocusDeadlineMisses = 0;
    return this.loadGeneration;
  }

  observeRuntime(input: {
    frameTimeMs: number;
    workerBusy: boolean | number;
    reservedExpandedBytes: number;
    activeWorkers: number;
    targetWorkers: number;
  }): void {
    this.observationDistributions.frameTimeMs.add(input.frameTimeMs);
    this.observationDistributions.workerBusyRatio.add(
      typeof input.workerBusy === "number"
        ? Math.max(0, Math.min(1, input.workerBusy))
        : input.workerBusy
          ? 1
          : 0,
    );
    this.observationDistributions.reservedExpandedBytes.add(
      input.reservedExpandedBytes,
    );
    this.observationDistributions.activeWorkers.add(input.activeWorkers);
    this.observationDistributions.targetWorkers.add(input.targetWorkers);
  }

  private getCurrentQueueDiagnostics(
    now: number,
  ): VoxelPipelineDiagnostics["currentQueue"] {
    const ages: VoxelPipelineDiagnostics["currentQueue"]["oldestDemandAgeMs"] =
      {
        overall: null,
        byLod: {},
        bySafetyClass: {},
        byCoverageClass: {},
        byViewClass: {},
        byPhase: {},
      };
    const executableStages: Record<string, VoxelStageUsage> = {};
    const nonExecutableDemand: VoxelPipelineDiagnostics["currentQueue"]["nonExecutableDemand"] =
      {
        fresh: 0,
        "known-missing": 0,
        "retry-exhausted": 0,
        "retry-delayed": 0,
      };
    const update = (
      group: Record<string, number>,
      key: string,
      age: number,
    ) => {
      group[key] = Math.max(group[key] ?? 0, age);
    };
    let jobs = 0;
    const groupedIdentities = new Set<string>();
    const recordPriority = (
      identity: string,
      priority: VoxelWorkPriority,
      stage: VoxelWorkStage,
    ) => {
      if (groupedIdentities.has(identity)) return;
      groupedIdentities.add(identity);
      const age = Math.max(0, now - priority.demandSince);
      ages.overall = Math.max(ages.overall ?? 0, age);
      update(ages.byLod, String(priority.lod), age);
      update(ages.bySafetyClass, priority.safetyClass, age);
      update(ages.byCoverageClass, priority.coverageClass, age);
      update(ages.byViewClass, priority.viewClass, age);
      update(ages.byPhase, priority.phase, age);
      let usage = executableStages[stage];
      if (!usage) {
        usage = emptyUsage();
        executableStages[stage] = usage;
      }
      usage.jobs++;
      jobs++;
    };
    for (const [key, demand] of this.demandIdentities) {
      const record = this.getBaseRecord(key, demand.version);
      if (!record) continue;
      if (!isExecutableBaseStage(record.stage)) {
        nonExecutableDemand[record.stage]++;
        continue;
      }
      recordPriority(`${key}:base`, record.priority, record.stage);
    }
    for (const record of this.records.values()) {
      if (record.stage === "inserted" || record.cancellationReason) continue;
      if (record.phase === "base" && !isExecutableBaseStage(record.stage)) {
        continue;
      }
      recordPriority(
        `${record.key}:${record.phase}`,
        record.priority,
        record.stage,
      );
    }
    return {
      jobs,
      executableStages,
      nonExecutableDemand,
      oldestDemandAgeMs: ages,
    };
  }

  setLimits(
    compact: VoxelStageLimits,
    expanded: VoxelStageLimits,
    retainedEnhancement: Partial<VoxelRetainedEnhancementLimits> = {},
  ): void {
    this.compactLimits = compact;
    this.expandedLimits = expanded;
    this.retainedEnhancementLimits = {
      ...this.retainedEnhancementLimits,
      ...retainedEnhancement,
    };
  }

  canStartFetch(): boolean {
    return hasCapacity(this.snapshot().compactInput, this.compactLimits);
  }

  canRetainEnhancement(bytes: number): boolean {
    const usage = this.snapshot().retainedEnhancementInput;
    return (
      usage.jobs === 0 ||
      (usage.jobs < this.retainedEnhancementLimits.maxJobs &&
        usage.bytes + bytes <= this.retainedEnhancementLimits.maxBytes)
    );
  }

  hasExecutableBaseWork(): boolean {
    return [...this.records.values()].some(
      (record) =>
        record.phase === "base" &&
        isExecutableBaseStage(record.stage) &&
        !record.cancellationReason,
    );
  }

  getExecutableBasePressure(now: number): VoxelExecutableBasePressure {
    let jobs = 0;
    let oldestAgeMs = 0;
    for (const record of this.records.values()) {
      if (
        record.phase !== "base" ||
        !isExecutableBaseStage(record.stage) ||
        record.cancellationReason
      ) {
        continue;
      }
      jobs++;
      oldestAgeMs = Math.max(oldestAgeMs, 0, now - record.priority.demandSince);
    }
    return { jobs, oldestAgeMs };
  }

  getRetainedEnhancementLimits(): VoxelRetainedEnhancementLimits {
    return { ...this.retainedEnhancementLimits };
  }

  getByKey(key: string): VoxelWorkRecord<TCompact, TExpanded>[] {
    return [...this.records.values()].filter((record) => record.key === key);
  }

  reconcileDemand<
    T extends {
      key: string;
      version: number;
      priority: VoxelWorkPriority;
      demandState?: VoxelDemandState;
    },
  >(requests: Map<string, T>, now: number): void {
    for (const [key, request] of requests) {
      const previous = this.demandIdentities.get(key);
      const identity =
        previous?.version === request.version
          ? previous
          : {
              version: request.version,
              demandSince: now,
              sequence: this.nextSequence++,
              priority: request.priority,
            };
      this.demandIdentities.set(key, identity);
      request.priority.demandSince = identity.demandSince;
      request.priority.sequence = identity.sequence;
      identity.priority = request.priority;
      if (request.priority.phase !== "base") continue;
      const record = this.getBaseRecord(key, request.version);
      const stage = demandStateToStage(request.demandState ?? "executable");
      if (!record) {
        this.records.set(
          this.nextJobId,
          this.createSelectedRecord(
            this.nextJobId++,
            key,
            request.version,
            request.priority,
            identity.demandSince,
            stage,
          ),
        );
      } else if (stage !== "selected" || !isActiveBaseStage(record.stage)) {
        record.stage = stage;
        record.priority = { ...request.priority, phase: "base" };
      }
    }
    for (const key of this.demandIdentities.keys()) {
      if (!requests.has(key)) this.demandIdentities.delete(key);
    }
  }

  createFetching(input: {
    key: string;
    version: number;
    priority: VoxelWorkPriority;
    selectedAt: number;
    fetchStartedAt: number;
  }): VoxelWorkRecord<TCompact, TExpanded> {
    const existing = this.getBaseRecord(input.key, input.version);
    if (existing) {
      existing.stage = "fetching";
      existing.priority = { ...input.priority, phase: "base" };
      existing.timestamps.fetchStartedAt = input.fetchStartedAt;
      return existing;
    }
    const record: VoxelWorkRecord<TCompact, TExpanded> = {
      jobId: this.nextJobId++,
      ...input,
      loadGeneration: this.loadGeneration,
      phase: input.priority.phase,
      stage: "fetching",
      compactBytes: 0,
      expandedBytes: 0,
      reservedExpandedBytes: 0,
      workerId: null,
      baseMeshId: null,
      timestamps: {
        selectedAt: input.selectedAt,
        fetchStartedAt: input.fetchStartedAt,
      },
    };
    this.records.set(record.jobId, record);
    return record;
  }

  markFetchQueued(key: string, version: number): boolean {
    const record = this.getBaseRecord(key, version);
    if (!record || record.stage !== "selected") return false;
    record.stage = "fetch-queued";
    return true;
  }

  markDemandState(
    key: string,
    version: number,
    demandState: VoxelDemandState,
  ): boolean {
    const record = this.getBaseRecord(key, version);
    if (!record || record.stage === "meshing") return false;
    record.stage = demandStateToStage(demandState);
    return true;
  }

  createRetainedEnhancement(input: {
    key: string;
    version: number;
    priority: VoxelWorkPriority;
    selectedAt: number;
    retainedAt: number;
    compact: TCompact;
    compactBytes: number;
    baseMeshId: number;
  }): VoxelWorkRecord<TCompact, TExpanded> {
    // Base workers can complete together. Retain every returned buffer so an
    // over-watermark wave cannot silently leave visible geometry unenhanced.
    // Dispatch pressure relief drains this observable overflow before normal
    // enhancement scheduling resumes.
    const record: VoxelWorkRecord<TCompact, TExpanded> = {
      jobId: this.nextJobId++,
      key: input.key,
      version: input.version,
      phase: "enhancement",
      loadGeneration: this.loadGeneration,
      priority: { ...input.priority, phase: "enhancement" },
      stage: "retained-enhancement-input",
      compactBytes: input.compactBytes,
      expandedBytes: 0,
      reservedExpandedBytes: 0,
      workerId: null,
      baseMeshId: input.baseMeshId,
      compact: input.compact,
      timestamps: {
        selectedAt: input.selectedAt,
        fetchCompletedAt: input.retainedAt,
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
    if (!record) return false;
    record.priority = { ...priority, phase: record.phase };
    return true;
  }

  dispatchNext(
    dispatchedAt: number,
    workerId = 0,
    getReservedExpandedBytes:
      | number
      | ((record: VoxelWorkRecord<TCompact, TExpanded>) => number) = 0,
    options: { activeWorkerCount?: number } = {},
  ): VoxelWorkRecord<TCompact, TExpanded> | null {
    if (
      [...this.records.values()].some(
        (record) => record.stage === "meshing" && record.workerId === workerId,
      )
    ) {
      return null;
    }
    const snapshot = this.snapshot();
    const candidates = [...this.records.values()].filter(
      (record) =>
        record.stage === "compact-input" ||
        record.stage === "retained-enhancement-input",
    );
    const executableBasePending = this.hasExecutableBaseWork();
    const pressureRelief = this.needsEnhancementPressureRelief();
    const activeWorkerCount = Math.max(1, options.activeWorkerCount ?? 1);
    const meshingCount = snapshot.activeWorker.jobs;
    const ordered = candidates
      .filter((record) => {
        if (record.phase === "base") return true;
        if (!executableBasePending) return true;
        if (!pressureRelief) return false;
        // With multiple workers, leave one idle lane for an arriving base result.
        return activeWorkerCount === 1 || meshingCount < activeWorkerCount - 1;
      })
      .sort((left, right) =>
        compareVoxelWorkPriority(left.priority, right.priority, dispatchedAt),
      );
    let next: VoxelWorkRecord<TCompact, TExpanded> | undefined;
    let reservation = 0;
    for (const candidate of ordered) {
      const estimate = Math.max(
        0,
        typeof getReservedExpandedBytes === "number"
          ? getReservedExpandedBytes
          : getReservedExpandedBytes(candidate),
      );
      if (this.canReserveExpandedOutput(snapshot, estimate)) {
        next = candidate;
        reservation = estimate;
        break;
      }
    }
    if (!next) return null;
    next.stage = "meshing";
    next.workerId = workerId;
    next.reservedExpandedBytes = reservation;
    next.timestamps.workerDispatchedAt = dispatchedAt;
    return next;
  }

  private canReserveExpandedOutput(
    snapshot: VoxelSchedulerSnapshot,
    estimate: number,
  ): boolean {
    const consumers =
      snapshot.expandedOutput.jobs + snapshot.reservedExpandedOutput.jobs;
    if (consumers === 0) return true;
    return (
      consumers < this.expandedLimits.maxJobs &&
      snapshot.expandedOutput.bytes +
        snapshot.reservedExpandedOutput.bytes +
        estimate <=
        this.expandedLimits.maxBytes
    );
  }

  private needsEnhancementPressureRelief(): boolean {
    const usage = this.snapshot().retainedEnhancementInput;
    return (
      usage.jobs >= this.retainedEnhancementLimits.highWaterJobs ||
      usage.bytes >= this.retainedEnhancementLimits.highWaterBytes
    );
  }

  failWorker(
    workerId: number,
    reason = "worker-lost",
  ): VoxelWorkRecord<TCompact, TExpanded>[] {
    const failed = [...this.records.values()].filter(
      (record) => record.stage === "meshing" && record.workerId === workerId,
    );
    for (const record of failed) this.finish(record.jobId, "error", reason);
    return failed;
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
    record.workerId = null;
    record.reservedExpandedBytes = 0;
    record.compact = undefined;
    record.compactBytes = 0;
    record.expanded = expanded;
    record.expandedBytes = bytes;
    record.timestamps.workerStartedAt = timing.workerStartedAt;
    record.timestamps.workerCompletedAt = timing.workerCompletedAt;
    record.timestamps.resultReceivedAt = timing.resultReceivedAt;
    const workerDuration = duration(
      timing.workerStartedAt,
      timing.workerCompletedAt,
    );
    if (
      record.loadGeneration === this.loadGeneration &&
      workerDuration !== null
    ) {
      this.observationDistributions.workerDurationMs.add(workerDuration);
    }
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

  markEnhancementAttached(jobId: number, attachedAt: number): boolean {
    const record = this.records.get(jobId);
    if (
      !record ||
      record.phase !== "enhancement" ||
      record.stage !== "expanded-output"
    ) {
      return false;
    }
    record.timestamps.sceneInsertedAt = attachedAt;
    record.timestamps.enhancedAt = attachedAt;
    return this.finish(jobId, "loaded");
  }

  cancel(
    jobId: number,
    reason: VoxelWorkCancellationReason,
  ): VoxelWorkRecord<TCompact, TExpanded> | null {
    const record = this.records.get(jobId);
    if (!record) return null;
    record.cancellationReason = reason;
    if (record.stage !== "meshing") {
      this.finish(record.jobId, "cancelled", reason);
    }
    return record;
  }

  finish(
    jobId: number,
    outcome: VoxelWorkTerminalOutcome,
    reason?: string,
  ): boolean {
    const record = this.records.get(jobId);
    if (!record || this.terminalOutcomes.has(jobId)) return false;
    record.terminalOutcome = outcome;
    record.workerId = null;
    record.reservedExpandedBytes = 0;
    this.recordDiagnostics(record, outcome, reason);
    if (
      outcome === "loaded" &&
      this.demandIdentities.get(record.key)?.version === record.version
    ) {
      this.demandIdentities.delete(record.key);
    }
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
      if (record.loadGeneration !== this.loadGeneration) return;
      const timing = deriveVoxelWorkTiming(record.timestamps);
      for (const key of Object.keys(timing) as (keyof VoxelWorkTiming)[]) {
        if (record.phase === "base" && key.startsWith("enhancement")) continue;
        if (record.phase === "base" && key === "selectionToEnhancedMs")
          continue;
        if (
          record.phase === "enhancement" &&
          (key === "baseWorkerExecutionMs" ||
            key === "selectionToBaseVisibleMs" ||
            key === "fetchMs" ||
            key === "compactQueueWaitMs" ||
            key === "resultTransferWaitMs" ||
            key === "sceneQueueWaitMs")
        ) {
          continue;
        }
        const value = timing[key];
        if (value === null) continue;
        this.timingDistributions[key].add(value);
      }
      if (
        record.phase === "base" &&
        record.priority.viewClass === "focus" &&
        timing.selectionToBaseVisibleMs !== null &&
        record.timestamps.firstVisibleAt !== undefined &&
        record.timestamps.firstVisibleAt - record.priority.demandSince >
          DEFAULT_VOXEL_URGENCY_CONFIG.focusDeadlineMs
      ) {
        this.currentFocusDeadlineMisses++;
      }
      return;
    }
    const terminalReason = reason ?? record.cancellationReason ?? outcome;
    const key = `${record.stage}:${terminalReason}`;
    const counts =
      outcome === "cancelled"
        ? this.cumulativeCancellations
        : this.cumulativeDiscards;
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
      const cancelledRecord = this.cancel(record.jobId, reason);
      if (cancelledRecord) cancelled.push(cancelledRecord);
    }
    if (reason === "demand-removed") this.demandIdentities.delete(key);
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
    if (reason === "shutdown") this.demandIdentities.clear();
    return cancelled;
  }

  snapshot(): VoxelSchedulerSnapshot {
    const snapshot: VoxelSchedulerSnapshot = {
      selected: emptyUsage(),
      fetchQueued: emptyUsage(),
      fetching: emptyUsage(),
      compactInput: emptyUsage(),
      retainedEnhancementInput: emptyUsage(),
      totalCompactInput: emptyUsage(),
      activeWorker: emptyUsage(),
      reservedExpandedOutput: emptyUsage(),
      expandedOutput: emptyUsage(),
    };
    for (const record of this.records.values()) {
      const usage =
        record.stage === "selected"
          ? snapshot.selected
          : record.stage === "fetch-queued"
            ? snapshot.fetchQueued
            : record.stage === "fetching"
              ? snapshot.fetching
              : record.stage === "compact-input" ||
                  record.stage === "retained-enhancement-input"
                ? snapshot.compactInput
                : record.stage === "meshing"
                  ? snapshot.activeWorker
                  : record.stage === "expanded-output"
                    ? snapshot.expandedOutput
                    : null;
      if (!usage) continue;
      usage.jobs += 1;
      usage.bytes +=
        record.stage === "compact-input" ||
        record.stage === "retained-enhancement-input" ||
        record.stage === "meshing"
          ? record.compactBytes
          : record.stage === "expanded-output"
            ? record.expandedBytes
            : 0;
      if (record.stage === "retained-enhancement-input") {
        snapshot.compactInput.jobs--;
        snapshot.compactInput.bytes -= record.compactBytes;
        snapshot.retainedEnhancementInput.jobs++;
        snapshot.retainedEnhancementInput.bytes += record.compactBytes;
      }
      if (record.reservedExpandedBytes > 0) {
        snapshot.reservedExpandedOutput.jobs += 1;
        snapshot.reservedExpandedOutput.bytes += record.reservedExpandedBytes;
      }
    }
    snapshot.totalCompactInput.jobs =
      snapshot.compactInput.jobs + snapshot.retainedEnhancementInput.jobs;
    snapshot.totalCompactInput.bytes =
      snapshot.compactInput.bytes + snapshot.retainedEnhancementInput.bytes;
    return snapshot;
  }

  assertProgressInvariant(): string[] {
    const violations: string[] = [];
    for (const [key, demand] of this.demandIdentities) {
      const record = this.getBaseRecord(key, demand.version);
      if (!record) violations.push(`${key}:${demand.version}`);
    }
    return violations;
  }

  private getBaseRecord(
    key: string,
    version: number,
  ): VoxelWorkRecord<TCompact, TExpanded> | undefined {
    return [...this.records.values()].find(
      (record) =>
        record.phase === "base" &&
        record.key === key &&
        record.version === version,
    );
  }

  private createSelectedRecord(
    jobId: number,
    key: string,
    version: number,
    priority: VoxelWorkPriority,
    selectedAt: number,
    stage: VoxelWorkStage,
  ): VoxelWorkRecord<TCompact, TExpanded> {
    return {
      jobId,
      key,
      version,
      phase: "base",
      loadGeneration: this.loadGeneration,
      priority: { ...priority, phase: "base" },
      stage,
      compactBytes: 0,
      expandedBytes: 0,
      reservedExpandedBytes: 0,
      workerId: null,
      baseMeshId: null,
      timestamps: { selectedAt },
    };
  }
}

function demandStateToStage(state: VoxelDemandState): VoxelWorkStage {
  return state === "executable" ? "selected" : state;
}

function isActiveBaseStage(
  stage: VoxelWorkStage,
): stage is Exclude<VoxelWorkStage, Exclude<VoxelDemandState, "executable">> {
  return ![
    "fresh",
    "known-missing",
    "retry-exhausted",
    "retry-delayed",
  ].includes(stage);
}

function isExecutableBaseStage(
  stage: VoxelWorkStage,
): stage is Exclude<VoxelWorkStage, Exclude<VoxelDemandState, "executable">> {
  return isActiveBaseStage(stage);
}
