export class RepairSlot {
  private current:
    { readonly number: number; readonly promise: Promise<void> } | undefined;

  get number() {
    return this.current?.number;
  }
  get running() {
    return this.current !== undefined;
  }

  start(number: number, work: () => Promise<void>): boolean {
    if (this.current) return false;
    const promise = Promise.resolve()
      .then(work)
      .finally(() => {
        this.current = undefined;
      });
    this.current = { number, promise };
    return true;
  }

  async finish() {
    await this.current?.promise;
  }
}
