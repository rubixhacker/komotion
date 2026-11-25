/**
 * A structural view of the agent's stream events. Declared here rather than
 * imported so the detector stays testable without the sandbox package.
 */
export type StreamEvent =
  | { readonly type: "text"; readonly message: string }
  | { readonly type: "toolCall"; readonly name: string; readonly formattedArgs: string }
  | { readonly type: "raw"; readonly line: string };

export interface StallReport {
  /** True when the same call has now repeated at or past the limit. */
  readonly stalled: boolean;
  /** The repeated call, as `name args`, or null before the first tool call. */
  readonly signature: string | null;
  /** Consecutive repeats of the current signature. */
  readonly repeats: number;
}

/**
 * Watches the agent's tool calls for a loop: the same call, unchanged, issued
 * over and over. An agent that probes for something the repository does not
 * have can re-issue an identical command indefinitely, because each emission
 * resets the library's idle timer.
 */
export class StallDetector {
  readonly #limit: number;
  #signature: string | null = null;
  #repeats = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 2)
      throw new RangeError("stall repeat limit must be an integer of at least 2");
    this.#limit = limit;
  }

  observe(event: StreamEvent): StallReport {
    // Prose and raw lines interleave with a loop, so they never reset the count.
    if (event.type !== "toolCall")
      return { stalled: false, signature: this.#signature, repeats: this.#repeats };
    const signature = `${event.name} ${event.formattedArgs}`;
    if (signature === this.#signature) this.#repeats += 1;
    else {
      this.#signature = signature;
      this.#repeats = 1;
    }
    return {
      stalled: this.#repeats >= this.#limit,
      signature,
      repeats: this.#repeats,
    };
  }
}
