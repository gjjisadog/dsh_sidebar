import type { DshConnection } from './dsh-connection.js'
import { decodeHistory } from './dsh-history.js'
import type { HistoryEntry } from './dsh-client.js'

/** Uses only cold persistence reads. follow() may promote a stored Agent. */
export class HistoryReader {
  constructor(private readonly connection: DshConnection) {}
  async page(sessionId: string, beforeSeq?: number, throughSeq?: number): Promise<{ events: HistoryEntry[]; hasMore: boolean; throughSeq: number }> {
    if (throughSeq === undefined) {
      const projection = await this.connection.call<{ kind: string; asOfSeq?: number } | null>('session/projections', { request: { sessionId } })
      if (projection?.kind !== 'sequenced' || !Number.isSafeInteger(projection.asOfSeq)) throw new Error('This history requires a newer DSH version or migration. Cached history is still available.')
      throughSeq = projection.asOfSeq!
    }
    const page = await this.connection.call<{ records: unknown; hasMore: boolean }>('session/page', {
      request: { address: { kind: 'session', sessionId }, throughSeq, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages: 100 },
    })
    if (typeof page.hasMore !== 'boolean') throw new Error('Invalid history page.')
    return { events: decodeHistory(page.records), hasMore: page.hasMore, throughSeq }
  }
}
