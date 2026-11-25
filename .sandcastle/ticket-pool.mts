export interface TicketWork {
  readonly number: number;
  readonly mode: "author" | "resume";
}

/**
 * Where an idle slot gets more work while the pass is still running.
 *
 * A pass plans once, at its start. Without this a ticket labelled a minute
 * later waits for the whole pass, however many slots sit idle: on 14 November
 * one slot stood empty for four hours beside a single slow ticket while sixteen
 * new tickets waited.
 */
export interface TicketRefill<T> {
  /** Newly planned tickets, or none. Never called by two slots at once. */
  readonly more: () => Promise<readonly T[]>;
  /**
   * Waits until asking again is worthwhile, and returns early once `stop()` is
   * true. Resolves false when the pass should take no more new work.
   */
  readonly idle: (stop: () => boolean) => Promise<boolean>;
  readonly onError: (error: unknown) => void;
}

/**
 * Continuously drains one ordered worklist through bounded workers. Resumes are
 * listed first, but a finished resume immediately frees its slot for new work.
 * The gate is checked before every dequeue, not once for the whole pass.
 *
 * With a `refill`, a slot that finds the worklist empty asks for more, and
 * keeps asking while another slot is still working. The pool ends when the
 * worklist is empty, a refill found nothing and no ticket is running.
 */
export async function runTicketPool<T extends TicketWork>(
  work: readonly T[],
  limit: number,
  canStart: (item: T) => boolean,
  fn: (item: T) => Promise<void>,
  onError: (item: T, error: unknown) => void,
  refill?: TicketRefill<T>,
): Promise<void> {
  const pending = [...work];
  let active = 0;
  let refilling: Promise<void> | null = null;
  const askForMore = (source: TicketRefill<T>): Promise<void> => {
    refilling ??= (async () => {
      try {
        pending.push(...(await source.more()));
      } catch (error) {
        source.onError(error);
      } finally {
        refilling = null;
      }
    })();
    return refilling;
  };
  const slots = refill === undefined ? Math.min(limit, pending.length) : limit;
  await Promise.all(
    Array.from({ length: slots }, async () => {
      for (;;) {
        const next = pending[0];
        if (next !== undefined) {
          if (!canStart(next)) return;
          pending.shift();
          active += 1;
          try {
            await fn(next);
          } catch (error) {
            onError(next, error);
          } finally {
            active -= 1;
          }
          continue;
        }
        if (refill === undefined) return;
        await askForMore(refill);
        if (pending.length > 0) continue;
        // Nothing is running and the refill just found nothing: the pass is done.
        if (active === 0) return;
        if (!(await refill.idle(() => active === 0 || pending.length > 0))) return;
        // The last running ticket ended while this slot waited, and its own
        // slot asks for more: wait for that answer rather than asking twice.
        if (refilling !== null) await refilling;
        if (active === 0 && pending.length === 0) return;
      }
    }),
  );
}
