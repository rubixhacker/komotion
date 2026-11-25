/**
 * Attempt marks for in-flight CI rebase/repair agents.
 *
 * A sweep records a head's mark before starting its agent: a genuine crash must
 * spend the attempt, or a broken run would retry on every sweep forever. An
 * operator stop, on the other hand, kills agents before they can finish, so the
 * marks still in flight must be released. Otherwise the next sweep sees those
 * heads as already attempted and escalates them to a human without giving the
 * rebase or repair a chance; four conflicting pull requests were stranded that
 * way during an infrastructure restart.
 */

/** The resume-attempts ledger, narrowed to what mark tracking needs. */
export interface CiMarkLedger {
  add(mark: string): void;
  forget(mark: string): void;
}

export class CiAttemptMarks {
  readonly #ledger: CiMarkLedger;
  readonly #inFlight = new Set<string>();

  constructor(ledger: CiMarkLedger) {
    this.#ledger = ledger;
  }

  /** Record the marks before the agent runs, so a crash still consumes them. */
  begin(marks: readonly string[]): void {
    for (const mark of marks) {
      this.#ledger.add(mark);
      this.#inFlight.add(mark);
    }
  }

  /** The agent ended, successfully or by throwing: its marks stay recorded. */
  end(marks: readonly string[]): void {
    for (const mark of marks) this.#inFlight.delete(mark);
  }

  /**
   * A deliberate stop killed the agents mid-flight. Release their marks so the
   * next pass can attempt those heads again. Marks of agents that already ended
   * are not released: a genuine crash still spends the attempt.
   */
  releaseOnStop(): void {
    for (const mark of this.#inFlight) this.#ledger.forget(mark);
    this.#inFlight.clear();
  }

  /** Run one agent attempt, recording its marks before it starts. */
  async run<T>(marks: readonly string[], work: () => Promise<T>): Promise<T> {
    this.begin(marks);
    try {
      return await work();
    } finally {
      this.end(marks);
    }
  }
}
