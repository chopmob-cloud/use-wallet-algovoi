import algosdk from 'algosdk'
import { AlgoVoiAdapter } from './adapter'
import { createTestHarness, type WalletState } from '@txnlab/use-wallet/testing'
import { byteArrayToBase64 } from '@txnlab/use-wallet/adapter'
import type { AdapterStoreAccessor } from '@txnlab/use-wallet/adapter'
import type { State, Store } from '@txnlab/use-wallet/testing'

// ── Mock @txnlab/use-wallet/adapter ───────────────────────────────────────────
// Preserve all real exports; override isTransactionArray and flattenTxnGroup so
// our minimal Transaction mocks are treated as Transaction[] without requiring
// the full algosdk address/encoding stack.

vi.mock('@txnlab/use-wallet/adapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('@txnlab/use-wallet/adapter')>()
  return {
    ...original,
    // Treat any array whose elements expose a toByte() method as Transaction[]
    isTransactionArray: vi.fn((group: unknown[]) =>
      group.length > 0 && typeof (group[0] as { toByte?: unknown }).toByte === 'function'
    ),
    // Return flat array as-is
    flattenTxnGroup: vi.fn((group: unknown[]) => group)
  }
})

// ── Mock window.algorand ──────────────────────────────────────────────────────

interface MockProvider {
  id: string
  version: string
  isAlgoVoi: boolean
  enable: ReturnType<typeof vi.fn>
  disable: ReturnType<typeof vi.fn>
  signTransactions: ReturnType<typeof vi.fn>
}

let mockProvider: MockProvider

function installProvider() {
  Object.defineProperty(window, 'algorand', {
    value: mockProvider,
    writable: true,
    configurable: true
  })
}

function removeProvider() {
  Object.defineProperty(window, 'algorand', {
    value: undefined,
    writable: true,
    configurable: true
  })
}

// ── Wallet factory ────────────────────────────────────────────────────────────

const WALLET_ID = 'algovoi'

function createWallet(store: AdapterStoreAccessor, timeoutMs = 5000): AlgoVoiAdapter {
  return new AlgoVoiAdapter({
    id: WALLET_ID,
    metadata: AlgoVoiAdapter.defaultMetadata,
    store,
    subscribe: vi.fn(),
    getAlgodClient: () => ({}) as never,
    options: { timeout: timeoutMs }
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AlgoVoiAdapter', () => {
  let wallet: AlgoVoiAdapter
  let store: Store<State>
  let accessor: AdapterStoreAccessor

  const account1 = { name: 'AlgoVoi Account 1', address: 'mockAddress1' }
  const account2 = { name: 'AlgoVoi Account 2', address: 'mockAddress2' }

  beforeEach(() => {
    vi.clearAllMocks()

    mockProvider = {
      id: 'algovoi',
      version: '1.0.0',
      isAlgoVoi: true,
      enable: vi.fn(),
      disable: vi.fn(),
      signTransactions: vi.fn()
    }

    installProvider()

    const harness = createTestHarness(WALLET_ID)
    store = harness.store
    accessor = harness.accessor

    wallet = createWallet(accessor)
  })

  afterEach(async () => {
    await wallet.disconnect()
    removeProvider()
  })

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct default metadata name', () => {
      expect(AlgoVoiAdapter.defaultMetadata.name).toBe('AlgoVoi')
    })

    it('should include a data URI icon', () => {
      expect(AlgoVoiAdapter.defaultMetadata.icon).toMatch(/^data:image\/svg\+xml;base64,/)
    })
  })

  // ── connect ───────────────────────────────────────────────────────────────

  describe('connect', () => {
    it('returns accounts and updates store on success', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address, account2.address] })

      const accounts = await wallet.connect()

      expect(mockProvider.enable).toHaveBeenCalled()
      expect(wallet.isConnected).toBe(true)
      expect(accounts).toEqual([account1, account2])
      expect(store.state.wallets[WALLET_ID]).toEqual({
        accounts: [account1, account2],
        activeAccount: account1
      })
    })

    it('throws and leaves store empty when enable() rejects', async () => {
      mockProvider.enable.mockRejectedValueOnce(new Error('User rejected'))

      await expect(wallet.connect()).rejects.toThrow('User rejected')
      expect(store.state.wallets[WALLET_ID]).toBeUndefined()
      expect(wallet.isConnected).toBe(false)
    })

    it('throws when enable() returns an empty account list', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [] })

      await expect(wallet.connect()).rejects.toThrow('No accounts found!')
      expect(store.state.wallets[WALLET_ID]).toBeUndefined()
    })

    it('sets the first account as activeAccount', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address, account2.address] })

      await wallet.connect()

      expect((store.state.wallets[WALLET_ID] as WalletState).activeAccount).toEqual(account1)
    })
  })

  // ── disconnect ────────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('calls provider.disable() and clears store', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address] })
      mockProvider.disable.mockResolvedValueOnce(undefined)

      await wallet.connect()
      await wallet.disconnect()

      expect(mockProvider.disable).toHaveBeenCalled()
      expect(wallet.isConnected).toBe(false)
      expect(store.state.wallets[WALLET_ID]).toBeUndefined()
    })

    it('still clears local state if disable() throws', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address] })
      mockProvider.disable.mockRejectedValueOnce(new Error('Extension gone'))

      await wallet.connect()
      await wallet.disconnect()

      expect(wallet.isConnected).toBe(false)
      expect(store.state.wallets[WALLET_ID]).toBeUndefined()
    })
  })

  // ── resumeSession ─────────────────────────────────────────────────────────

  describe('resumeSession', () => {
    it('is a no-op when there is no stored session', async () => {
      await wallet.resumeSession()

      expect(wallet.isConnected).toBe(false)
      expect(mockProvider.enable).not.toHaveBeenCalled()
    })

    it('reconnects to the provider when a session exists', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address] })
      await wallet.connect()

      await wallet.resumeSession()

      expect(wallet.isConnected).toBe(true)
    })

    it('calls onDisconnect and throws when provider is unavailable during resume', async () => {
      // Connect first so a session exists in the store
      mockProvider.enable.mockResolvedValueOnce({ accounts: [account1.address] })
      await wallet.connect()

      // Remove the provider and clear the cached reference — use a very short
      // timeout so the test doesn't wait for the full 3-minute default.
      removeProvider()
      // @ts-expect-error accessing private field for test
      wallet._provider = null

      const shortTimeoutWallet = createWallet(accessor, 50 /* ms */)
      // @ts-expect-error accessing private field for test
      shortTimeoutWallet._provider = null

      await expect(shortTimeoutWallet.resumeSession()).rejects.toThrow(
        'AlgoVoi extension not detected'
      )
      expect(shortTimeoutWallet.isConnected).toBe(false)
    }, 3000 /* test timeout */)
  })

  // ── signTransactions ──────────────────────────────────────────────────────

  describe('signTransactions', () => {
    const MOCK_ADDRESS = 'mockAddress1'

    /** Minimal Transaction-shaped object — real enough for processTxns. */
    function makeTxn(sender = MOCK_ADDRESS): algosdk.Transaction {
      return {
        sender: { toString: () => sender },
        toByte: () => new Uint8Array([1, 2, 3])
      } as unknown as algosdk.Transaction
    }

    beforeEach(async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [MOCK_ADDRESS] })
      await wallet.connect()
    })

    it('sends transactions to the provider and returns Uint8Arrays', async () => {
      const signedB64 = btoa(String.fromCharCode(0x01, 0x02, 0x03))
      mockProvider.signTransactions.mockResolvedValueOnce([signedB64])

      const result = await wallet.signTransactions([makeTxn()])

      expect(mockProvider.signTransactions).toHaveBeenCalled()
      expect(result[0]).toBeInstanceOf(Uint8Array)
    })

    it('returns null for skipped transactions', async () => {
      mockProvider.signTransactions.mockResolvedValueOnce([null])

      const result = await wallet.signTransactions([makeTxn()])

      expect(result[0]).toBeNull()
    })

    it('marks non-signer transactions with signers: []', async () => {
      const ownTxnB64 = byteArrayToBase64(new Uint8Array([1, 2, 3]))
      const otherTxnB64 = byteArrayToBase64(new Uint8Array([1, 2, 3]))

      mockProvider.signTransactions.mockResolvedValueOnce([btoa('signed'), null])

      await wallet.signTransactions([makeTxn(MOCK_ADDRESS), makeTxn('otherAddress')])

      const callArg: Array<{ txn: string; signers?: string[] }> =
        mockProvider.signTransactions.mock.calls[0][0]

      expect(callArg[0]).toEqual({ txn: ownTxnB64 })
      expect(callArg[1]).toEqual({ txn: otherTxnB64, signers: [] })
    })

    it('propagates errors from the provider', async () => {
      mockProvider.signTransactions.mockRejectedValueOnce(new Error('User cancelled'))

      await expect(wallet.signTransactions([makeTxn()])).rejects.toThrow('User cancelled')
    })
  })
})
