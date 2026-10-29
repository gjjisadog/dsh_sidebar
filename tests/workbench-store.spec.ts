import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchStore, recordKey } from '../src/workbench-store.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function storage() { const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-')); roots.push(root); return new WorkbenchStore(root) }
it('serializes read-modify-write across independent windows', async () => {
  const first = await storage(), second = new WorkbenchStore(first.root)
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).edit<number>('counter', old => (old ?? 0) + 1)))
  expect(await first.read('counter')).toBe(12)
})
it('an absent pending request does not create an invalid record', async () => {
  const store = await storage()
  await store.edit('pending', old => old)
  expect(await store.read('pending')).toBeUndefined()
})
it('isolates corrupted records from the catalog', async () => {
  const store = await storage()
  await store.edit('good', () => ({ recordType: 'project', id: 'ok' }))
  await writeFile(join(store.root, recordKey('bad')+'.json'), 'broken')
  expect(await store.records('project')).toEqual([{ recordType: 'project', id: 'ok' }])
  await expect(store.read('bad')).rejects.toThrow('unreadable')
})
it('claims a pending request once across two hosts', async () => {
  const store = await storage(), other = new WorkbenchStore(store.root)
  await store.edit('resume', () => ({ consumed: false }))
  let count = 0
  await Promise.all([store, other].map(host => host.edit<{consumed:boolean}>('resume', old => {
    if (old && !old.consumed) count++
    return { consumed: true }
  })))
  expect(count).toBe(1)
})
it('reclaims a lock only after its process has exited', async () => {
  const store = await storage()
  await writeFile(join(store.root, recordKey('x')+'.json.lock'), JSON.stringify({ pid: 2147483647, token: 'dead' }))
  await store.edit('x', () => 1)
  expect(await store.read('x')).toBe(1)
})
