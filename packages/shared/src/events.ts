export interface ScheduledEvent {
  time: number;
  name: string;
  payload?: unknown;
  seq: number;
}

export interface SimulationSnapshot {
  time: number;
  state: Readonly<Record<string, unknown>>;
  pendingEvents: number;
}

export interface TraceSample {
  time: number;
  state: Record<string, unknown>;
}
