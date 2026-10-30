/**
 * A test's way to kill this process after its Nth write, as a reboot or a
 * killed session would, so a test can leave the deck as a verb that died
 * between any two of its writes leaves it. Each write primitive a plan verb
 * uses calls `wrote` once its write has landed. Inert unless the test sets
 * the variable.
 */
const AFTER = Number(process.env.CARD_DIE_AFTER ?? 0);
let writes = 0;

export function wrote(): void {
  if (AFTER > 0 && ++writes === AFTER) process.kill(process.pid, "SIGKILL");
}
