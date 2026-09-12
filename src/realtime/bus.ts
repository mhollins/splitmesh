type Handler = (eventId: string, seq: number, type: string) => void;

export class EventBus {
  private listeners = new Map<string, Set<Handler>>();

  subscribe(eventId: string, handler: Handler): () => void {
    let set = this.listeners.get(eventId);
    if (!set) {
      set = new Set();
      this.listeners.set(eventId, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.listeners.delete(eventId);
    };
  }

  publish(eventId: string, seq: number, type: string): void {
    const set = this.listeners.get(eventId);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(eventId, seq, type);
      } catch {
        // A single subscriber must not break fan-out.
      }
    }
  }
}
