import algosdk from 'algosdk'
import {
  BaseWallet,
  byteArrayToBase64,
  flattenTxnGroup,
  isSignedTxn,
  isTransactionArray,
  type AdapterConstructorParams,
  type WalletAccount,
  type WalletMetadata,
  type WalletState
} from '@txnlab/use-wallet/adapter'
import { icon } from './icon'

// ── ARC-27 provider interface ──────────────────────────────────────────────────

/** ARC-27 signed-or-skipped transaction format sent to the extension. */
interface WalletTransaction {
  txn: string        // base64-encoded unsigned transaction
  signers?: string[] // empty array = wallet should not sign this txn
}

/**
 * ARC-27 compliant provider injected at `window.algorand`
 * by the AlgoVoi browser extension.
 */
interface AlgoVoiProvider {
  id: string
  version: string
  isAlgoVoi: boolean
  enable(options?: { genesisHash?: string }): Promise<{ accounts: string[] }>
  disable(options?: { genesisHash?: string }): Promise<void>
  signTransactions(txns: WalletTransaction[], indexesToSign?: number[]): Promise<(string | null)[]>
  signBytes?(data: Uint8Array, signer: string): Promise<{ sig: Uint8Array }>
}

declare global {
  interface Window {
    algorand?: AlgoVoiProvider
  }
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface AlgoVoiOptions {
  /** Override the provider detection timeout in milliseconds. Default: 180 000 (3 min). */
  timeout?: number
}

// ── Provider detection ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 180_000

/**
 * Waits for the AlgoVoi provider to be injected.
 * Returns immediately if already present, otherwise listens for the
 * `algorand#initialized` event fired by the extension content script.
 */
function waitForProvider(timeout: number): Promise<AlgoVoiProvider> {
  return new Promise((resolve, reject) => {
    if (window.algorand?.isAlgoVoi) {
      return resolve(window.algorand)
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener('algorand#initialized', handler)
      reject(new Error('AlgoVoi extension not detected — timed out waiting for provider'))
    }, timeout)

    function handler() {
      window.clearTimeout(timer)
      window.removeEventListener('algorand#initialized', handler)
      if (window.algorand?.isAlgoVoi) {
        resolve(window.algorand)
      } else {
        reject(new Error('algorand#initialized fired but AlgoVoi provider not found'))
      }
    }

    window.addEventListener('algorand#initialized', handler)
  })
}

// ── Adapter ────────────────────────────────────────────────────────────────────

const ICON = `data:image/svg+xml;base64,${btoa(icon)}`

export class AlgoVoiAdapter extends BaseWallet<AlgoVoiOptions> {
  private _provider: AlgoVoiProvider | null = null

  constructor(params: AdapterConstructorParams<AlgoVoiOptions>) {
    super(params)
  }

  static defaultMetadata: WalletMetadata = {
    name: 'AlgoVoi',
    icon: ICON
  }

  // ── Provider ─────────────────────────────────────────────────────────────────

  private async getProvider(): Promise<AlgoVoiProvider> {
    if (this._provider) return this._provider
    this.logger.info('Waiting for AlgoVoi provider...')
    this._provider = await waitForProvider(this.options?.timeout ?? DEFAULT_TIMEOUT)
    this.logger.info('AlgoVoi provider detected')
    return this._provider
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  public connect = async (): Promise<WalletAccount[]> => {
    this.logger.info('Connecting...')
    const provider = await this.getProvider()
    const result = await provider.enable()

    if (result.accounts.length === 0) {
      this.logger.error('No accounts found!')
      throw new Error('No accounts found!')
    }

    const walletAccounts: WalletAccount[] = result.accounts.map((address, idx) => ({
      name: `AlgoVoi Account ${idx + 1}`,
      address
    }))

    const walletState: WalletState = {
      accounts: walletAccounts,
      activeAccount: walletAccounts[0]
    }

    this.store.addWallet(walletState)
    this.logger.info('Connected successfully', walletState)
    return walletAccounts
  }

  public disconnect = async (): Promise<void> => {
    this.logger.info('Disconnecting...')
    try {
      const provider = await this.getProvider()
      await provider.disable()
    } catch {
      // Extension may not be available — clean up local state regardless
    }
    this.onDisconnect()
    this.logger.info('Disconnected')
  }

  public resumeSession = async (): Promise<void> => {
    try {
      const walletState = this.store.getWalletState()
      if (!walletState) {
        this.logger.info('No session to resume')
        return
      }
      this.logger.info('Resuming session...')
      // Verify the extension is still present without re-prompting the user
      await this.getProvider()
      this.logger.info('Session resumed successfully')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error('Error resuming session:', message)
      this.onDisconnect()
      throw error
    }
  }

  // ── Transaction helpers ───────────────────────────────────────────────────────

  private processTxns(
    txnGroup: algosdk.Transaction[],
    indexesToSign?: number[]
  ): WalletTransaction[] {
    return txnGroup.map((txn, index) => {
      const isIndexMatch = !indexesToSign || indexesToSign.includes(index)
      const signer = txn.sender.toString()
      const canSign = this.addresses.includes(signer)
      const txnString = byteArrayToBase64(txn.toByte())
      return isIndexMatch && canSign
        ? { txn: txnString }
        : { txn: txnString, signers: [] }
    })
  }

  private processEncodedTxns(
    txnGroup: Uint8Array[],
    indexesToSign?: number[]
  ): WalletTransaction[] {
    return txnGroup.map((txnBuffer, index) => {
      const decodedObj = algosdk.msgpackRawDecode(txnBuffer)
      const isSigned = isSignedTxn(decodedObj)
      const txn = isSigned
        ? algosdk.decodeSignedTransaction(txnBuffer).txn
        : algosdk.decodeUnsignedTransaction(txnBuffer)

      const isIndexMatch = !indexesToSign || indexesToSign.includes(index)
      const signer = txn.sender.toString()
      const canSign = !isSigned && this.addresses.includes(signer)
      const txnString = byteArrayToBase64(txn.toByte())
      return isIndexMatch && canSign
        ? { txn: txnString }
        : { txn: txnString, signers: [] }
    })
  }

  // ── Signing ───────────────────────────────────────────────────────────────────

  public signTransactions = async <T extends algosdk.Transaction[] | Uint8Array[]>(
    txnGroup: T | T[],
    indexesToSign?: number[]
  ): Promise<(Uint8Array | null)[]> => {
    this.logger.debug('Signing transactions...', { txnGroup, indexesToSign })

    const txnsToSign: WalletTransaction[] = isTransactionArray(txnGroup)
      ? this.processTxns(flattenTxnGroup(txnGroup), indexesToSign)
      : this.processEncodedTxns(flattenTxnGroup(txnGroup as Uint8Array[]), indexesToSign)

    const provider = await this.getProvider()
    this.logger.debug('Sending transactions to AlgoVoi for signing...', txnsToSign)

    const signedB64s = await provider.signTransactions(txnsToSign)

    const result = signedB64s.map((value) => {
      if (value === null) return null
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    })

    this.logger.debug('Transactions signed successfully', result)
    return result
  }
}
