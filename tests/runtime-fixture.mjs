import { spawn } from 'node:child_process'
import { once } from 'node:events'

/** Launch only with the caller's isolated environment; never inherit provider credentials. */
export async function startRuntimeFixture(cli, workspace, env, patch) {
  const child = spawn(process.execPath, [cli, 'web', ...(patch ? ['--patch', patch] : []),
    '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  let output = ''
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    try { await exited } finally { clearTimeout(timer) }
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated DSH startup timed out')), 30000)
      const read = chunk => {
        output = (output + chunk).slice(-32000)
        const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/.exec(output)
        if (match) { clearTimeout(timer); resolve(new URL(match[1])) }
      }
      child.stdout.on('data', read); child.stderr.on('data', read)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Isolated DSH exited (${code})`)) })
    })
    return { url, stop, get diagnostics() { return output.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]') } }
  } catch (error) { await stop(); throw error }
}
