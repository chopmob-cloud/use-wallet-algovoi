import { AlgoVoiAdapter } from './adapter'
import type { AlgoVoiOptions } from './adapter'
import type { WalletAdapterConfig } from '@txnlab/use-wallet'

export const WALLET_ID = 'algovoi' as const

export function algovoi(options?: AlgoVoiOptions): WalletAdapterConfig {
  return {
    id: WALLET_ID,
    metadata: AlgoVoiAdapter.defaultMetadata,
    Adapter: AlgoVoiAdapter as unknown as WalletAdapterConfig['Adapter'],
    options: options as unknown as Record<string, unknown> | undefined
  }
}

export { AlgoVoiAdapter }
export type { AlgoVoiOptions }
