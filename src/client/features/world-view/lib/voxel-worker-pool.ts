export interface VoxelWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

interface VoxelWorkerSlot {
  id: number;
  state: "idle" | "busy";
}

interface InternalVoxelWorkerSlot extends VoxelWorkerSlot {
  worker: VoxelWorkerLike;
  retireWhenIdle: boolean;
}

export class VoxelWorkerPool<TMessage> {
  private readonly slots = new Map<number, InternalVoxelWorkerSlot>();
  private nextWorkerId = 1;
  private target: number;
  private stopped = false;

  constructor(
    private readonly options: {
      initialWorkers: number;
      maxWorkers: number;
      createWorker: () => VoxelWorkerLike;
      onMessage: (workerId: number, message: TMessage) => void;
      onError: (workerId: number) => void;
    },
  ) {
    this.target = this.clampTarget(options.initialWorkers);
    this.ensureTarget();
  }

  get activeCount(): number {
    return this.slots.size;
  }

  get busyCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.state === "busy") count++;
    }
    return count;
  }

  get targetCount(): number {
    return this.target;
  }

  snapshot(): VoxelWorkerSlot[] {
    return [...this.slots.values()]
      .map(({ id, state }) => ({ id, state }))
      .sort((left, right) => left.id - right.id);
  }

  setTarget(target: number): void {
    if (this.stopped) return;
    this.target = this.clampTarget(target);
    this.retireExcessIdleWorkers();
    this.ensureTarget();
  }

  dispatchToIdle(
    dispatch: (workerId: number, worker: VoxelWorkerLike) => boolean,
  ): number {
    if (this.stopped) return 0;
    let dispatched = 0;
    for (const slot of [...this.slots.values()].sort(
      (left, right) => left.id - right.id,
    )) {
      if (slot.state !== "idle" || slot.retireWhenIdle) continue;
      if (!dispatch(slot.id, slot.worker)) break;
      slot.state = "busy";
      dispatched++;
    }
    return dispatched;
  }

  complete(workerId: number): boolean {
    const slot = this.slots.get(workerId);
    if (!slot || slot.state !== "busy") return false;
    slot.state = "idle";
    if (slot.retireWhenIdle || this.slots.size > this.target) {
      this.removeSlot(slot);
    }
    this.ensureTarget();
    return true;
  }

  postToWorker(
    workerId: number,
    message: unknown,
    transfer?: Transferable[],
  ): boolean {
    const slot = this.slots.get(workerId);
    if (!slot) return false;
    slot.worker.postMessage(message, transfer);
    return true;
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const slot of this.slots.values()) slot.worker.terminate();
    this.slots.clear();
  }

  private clampTarget(target: number): number {
    return Math.max(1, Math.min(this.options.maxWorkers, Math.floor(target)));
  }

  private ensureTarget(): void {
    while (!this.stopped && this.slots.size < this.target) {
      const id = this.nextWorkerId++;
      const worker = this.options.createWorker();
      const slot: InternalVoxelWorkerSlot = {
        id,
        state: "idle",
        worker,
        retireWhenIdle: false,
      };
      worker.onmessage = (event) => {
        if (this.slots.get(id) !== slot) return;
        this.options.onMessage(id, event.data as TMessage);
      };
      worker.onerror = () => {
        if (this.slots.get(id) !== slot) return;
        this.removeSlot(slot);
        this.options.onError(id);
        this.ensureTarget();
      };
      this.slots.set(id, slot);
    }
  }

  private retireExcessIdleWorkers(): void {
    let excess = Math.max(0, this.slots.size - this.target);
    const slots = [...this.slots.values()].sort(
      (left, right) => right.id - left.id,
    );
    for (const slot of slots) {
      slot.retireWhenIdle = false;
      if (excess === 0) continue;
      if (slot.state === "idle") this.removeSlot(slot);
      else slot.retireWhenIdle = true;
      excess--;
    }
  }

  private removeSlot(slot: InternalVoxelWorkerSlot): void {
    if (!this.slots.delete(slot.id)) return;
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
  }
}
