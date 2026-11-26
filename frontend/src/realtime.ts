import type {
  Bar,
  BarSubscriptionOptions,
  BarsRequest,
  LiveBarMeta,
  UnsubscribeFn,
} from 'openalgo-charts'

/**
 * Realtime is deliberately a separate provider from historical REST storage.
 * A provider may be backed by the Options Dashboard's existing streamer today,
 * or an Angel One gateway in the future, without changing the chart engine or
 * its historical history adapter.
 *
 * All bars passed into the chart use UTC epoch seconds. The provider owns
 * exchange timestamps, tick aggregation, reconnect/resync and duplicate
 * suppression. It must not fabricate missing prices during feed gaps.
 */
export type RealtimeConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'disconnected'

export interface RealtimeStatus {
  state: RealtimeConnectionState
  message?: string
  updatedAt?: number
}

export interface RealtimeProvider {
  subscribeBars(
    request: BarsRequest,
    onBar: (bar: Bar, meta?: LiveBarMeta) => void,
    onStatus: (status: RealtimeStatus) => void,
    options?: BarSubscriptionOptions,
  ): UnsubscribeFn
}
