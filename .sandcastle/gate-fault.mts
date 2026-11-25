/**
 * The fault in a failed `qualityGate` run that no change to the branch can
 * fix, or null when the failure may be the branch's own.
 *
 * On 15 November the host's gate ran out of JVM heap on a branch that changed
 * two Swift files. The factory sent the failure to a repair agent, which
 * rightly changed nothing, and the ticket earned a strike for it. A fault
 * listed here is the host's: the gate is run again, and a second fault retains
 * the branch and tells the operator instead of striking the ticket.
 *
 * The patterns are the exact phrases the JVM, Gradle and the kernel print.
 * Gradle's own warning that a daemon is "running out of JVM heap space" is not
 * one: the build can still pass after it.
 */
export function gateFault(output: string): string | null {
  // Before the memory patterns: the JVM reports a thread it could not start as
  // an OutOfMemoryError too.
  if (/pthread_create failed \(EAGAIN\)|pthread_create: Resource temporarily unavailable|unable to create native thread/.test(output))
    return "the sandbox ran out of processes";
  if (/java\.lang\.OutOfMemoryError|Java heap space|GC overhead limit exceeded|Cannot allocate memory/.test(output))
    return "the build ran out of memory";
  if (/No space left on device/.test(output)) return "the disk is full";
  if (/Gradle build daemon disappeared unexpectedly|Gradle build daemon has been stopped/.test(output))
    return "the Gradle daemon died";
  return null;
}
