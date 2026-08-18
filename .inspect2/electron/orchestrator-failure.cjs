/**
 * What the user reads when the orchestrator does not come up.
 *
 * Extracted from main.cjs because one of these outcomes is not a crash and must not read like one.
 * When another orchestrator already owns the state profile, the old dialog showed the raw stderr
 * tail — a minified stack trace ending in `throw new OrchestratorAlreadyRunningError(path23)` —
 * under the heading "failed to start or stopped unexpectedly", with Show Log and Quit as the only
 * ways out. Nothing in that tells someone what happened or what to do about it, and the one person
 * who reported it worked the answer out themselves and posted it in Discord.
 */

// The orchestrator exits with this instead of throwing when the profile is already owned; see
// PROFILE_BUSY_EXIT in src/server/main.ts, which must stay in step with it. (Both sides of this
// boundary spell their shared constants out separately — the `[orchestrator-ready]` prefix and the
// FREEBUFF_* env names do the same — because the shell runs Node and cannot import the server's TS.)
// 75 is sysexits' EX_TEMPFAIL: nothing is broken, something else is holding what we wanted.
const PROFILE_BUSY_EXIT = 75

// Where a person goes to end a stray process, by platform. Naming the actual application beats
// "your task manager" — the whole point is that the reader should not have to translate anything.
const PROCESS_MONITORS = { win32: 'Task Manager', darwin: 'Activity Monitor' }

function describeProfileBusy(platform) {
  const monitor = PROCESS_MONITORS[platform] ?? 'your system monitor'
  return {
    // Nothing failed, so neither the title bar nor the icon may say it did. A window titled
    // "Freebuff failed to start" over the words "Freebuff is already open" just contradicts itself.
    title: 'Freebuff',
    type: 'info',
    message: 'Freebuff is already open',
    detail:
      'Another copy of Freebuff has your workspace open, so this one stopped instead of ' +
      'competing with it for your threads.\n\n' +
      'If you can see a Freebuff window, use that one. If you cannot, a leftover background ' +
      `process is still holding the workspace: quit "bun" in ${monitor}, then open Freebuff again.`,
  }
}

function describeFailure(failure) {
  // An understood outcome, not a fault: say what happened and stop. The log still has everything,
  // and the dialog still offers it — but a stack trace is not the answer to this question.
  if (failure.code === PROFILE_BUSY_EXIT) return describeProfileBusy(failure.platform)

  const detailParts = []
  if (failure.errorMessage) detailParts.push(failure.errorMessage)
  if (failure.kind === 'timeout') detailParts.push('The orchestrator did not become ready in time.')
  if (failure.code !== undefined || failure.signal) {
    detailParts.push(`Process ended (code ${failure.code ?? 'none'}, signal ${failure.signal ?? 'none'}).`)
  }
  if (failure.stderrTail) detailParts.push(`\nRecent log output:\n${failure.stderrTail.trim()}`)
  return {
    title: 'Freebuff failed to start',
    type: 'error',
    message: 'The Freebuff orchestrator failed to start or stopped unexpectedly.',
    detail: detailParts.join('\n'),
  }
}

module.exports = { describeFailure, PROFILE_BUSY_EXIT }
