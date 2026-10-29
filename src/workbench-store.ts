import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const recordKey = (value: string): string => createHash('sha256').update(value).digest('hex')
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Per-record transactions shared by extension hosts in one VS Code profile. */
export class WorkbenchStore {
  private readonly held = new Map<string, string>()
  constructor(readonly root: string) {}
  private file(key: string): string { return join(this.root, recordKey(key) + '.json') }
  async read<T>(key: string): Promise<T | undefined> {
    try { return JSON.parse(await readFile(this.file(key), 'utf8')) as T }
    catch (error) { if (missing(error)) return undefined; throw new Error('Workbench record is unreadable: ' + recordKey(key)) }
  }
  async records<T>(prefix: string): Promise<T[]> {
    await mkdir(this.root, { recursive: true })
    const values: T[] = []
    for (const file of await readdir(this.root)) {
      if (!file.endsWith('.json')) continue
      try {
        const value = JSON.parse(await readFile(join(this.root, file), 'utf8'))
        if (value?.recordType === prefix) values.push(value as T)
      } catch { /* A damaged record must not hide the remaining catalog. */ }
    }
    return values
  }
  async acquire(key: string): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true })
    const lock = this.file(key) + '.lock'
    const token = randomUUID()
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await writeFile(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 })
        return async () => {
          const owner = JSON.parse(await readFile(lock, 'utf8').catch(() => '{}'))
          if (owner.token === token) await rm(lock, { force: true })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          const owner = JSON.parse(await readFile(lock, 'utf8'))
          try { process.kill(owner.pid, 0) } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
              const reclaim = lock + '.reclaim'
              try {
                await writeFile(reclaim, token, { flag: 'wx', mode: 0o600 })
                try {
                  const current = JSON.parse(await readFile(lock, 'utf8'))
                  if (current.token === owner.token) await rm(lock, { force: true })
                } finally { await rm(reclaim, { force: true }) }
              } catch { /* Another host is reclaiming, or the lock has already changed. */ }
              continue
            }
          }
        } catch { /* Never steal an unverified or partially written lock. */ }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    throw new Error('This record is in use by another window. Try again after closing that window.')
  }
  async edit<T>(key: string, update: (value: T | undefined) => T): Promise<T> {
    const release = await this.acquire(key)
    try {
      const next = update(await this.read<T>(key))
      if (next === undefined) return next
      const temp = this.file(key) + '.' + randomUUID() + '.tmp'
      try { await writeFile(temp, JSON.stringify(next), { mode: 0o600 }); await rename(temp, this.file(key)) }
      finally { await rm(temp, { force: true }) }
      return next
    } finally { await release() }
  }
  async claimDraft(key: string): Promise<void> {
    if (this.held.has(key)) return
    const release = await this.acquire('draft-owner:' + key)
    const id = randomUUID()
    this.held.set(key, id)
    this.releases.set(key, release)
  }
  private readonly releases = new Map<string, () => Promise<void>>()
  async close(): Promise<void> {
    await Promise.all([...this.releases.values()].map(release => release()))
    this.held.clear(); this.releases.clear()
  }
}
