import { expect, it, vi } from 'vitest'
import { HistoryReader } from '../src/history-reader.js'
it('reads a cold history without following, creating or prompting an Agent', async () => {
  const call = vi.fn().mockResolvedValueOnce({kind:'sequenced',asOfSeq:12}).mockResolvedValueOnce({records:[],hasMore:true}).mockResolvedValueOnce({records:[],hasMore:false})
  const reader = new HistoryReader({call} as any)
  await reader.page('cold')
  await reader.page('cold', 3, 12)
  expect(call.mock.calls.map(args => args[0])).toEqual(['session/projections','session/page','session/page'])
  expect(call.mock.calls[2]?.[1]).toEqual({request:{address:{kind:'session',sessionId:'cold'},throughSeq:12,beforeSeq:3,maxMessages:100}})
})
it('never falls back to activation for migration-required or absent projections', async () => {
  for (const projection of [null, {kind:'migration-required'}, {kind:'sequenced',asOfSeq:'bad'}]) {
    const call = vi.fn().mockResolvedValue(projection)
    await expect(new HistoryReader({call} as any).page('old')).rejects.toThrow('migration')
    expect(call).toHaveBeenCalledTimes(1)
  }
})
