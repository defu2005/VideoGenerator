import { EventEmitter } from "node:events";
import type { PipelineEvent } from "@vg/shared";

type Listener = (event: PipelineEvent) => void;

export class PipelineEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: PipelineEvent): void {
    this.emitter.emit(event.projectId, event);
  }

  subscribe(projectId: string, listener: Listener): () => void {
    this.emitter.on(projectId, listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.emitter.off(projectId, listener);
    };
  }

  listenerCount(projectId: string): number {
    return this.emitter.listenerCount(projectId);
  }
}
