/**
 * E2E simulation — exercises the full WalletManager → AlgoVoiAdapter →
 * window.algorand chain using a mocked ARC-27 provider in jsdom.
 *
 * This is as close as we can get to a real browser flow without an actual
 * extension installed: a real WalletManager instance initialises the adapter,
 * which calls through to the mocked window.algorand exactly as it would in a dApp.
 */

import { WalletManager } from '@txnlab/use-wallet'
import { algovoi, AlgoVoiAdapter } from './index'

// Mock isTransactionArray so our minimal Transaction-shaped mocks are treated
// as Transaction[] without requiring the full algosdk address/encoding stack.
vi.mock('@txnlab/use-wallet/adapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('@txnlab/use-wallet/adapter')>()
  return {
    ...original,
    isTransactionArray: vi.fn((group: unknown[]) =>
      group.length > 0 && typeof (group[0] as { toByte?: unknown }).toByte === 'function'
    ),
    flattenTxnGroup: vi.fn((group: unknown[]) => group)
  }
})

// ── Mock window.algorand ──────────────────────────────────────────────────────

const MOCK_ADDRESS_1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const MOCK_ADDRESS_2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

interface MockProvider {
  id: string
  version: string
  isAlgoVoi: boolean
  enable: ReturnType<typeof vi.fn>
  disable: ReturnType<typeof vi.fn>
  signTransactions: ReturnType<typeof vi.fn>
}

let mockProvider: MockProvider

function installProvider(provider = mockProvider) {
  Object.defineProperty(window, 'algorand', {
    value: provider,
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

// ── WalletManager factory ─────────────────────────────────────────────────────

function createManager(): WalletManager {
  return new WalletManager({
    wallets: [algovoi({ timeout: 5000 })]
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AlgoVoi v5 E2E simulation', () => {
  let manager: WalletManager

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
    manager = createManager()
  })

  afterEach(async () => {
    await manager.disconnect()
    removeProvider()
  })

  // ── WalletManager integration ─────────────────────────────────────────────

  describe('WalletManager initialisation', () => {
    it('registers the AlgoVoi wallet provider', () => {
      const wallet = manager.getWallet(WALLET_ID)
      expect(wallet).toBeDefined()
      expect(wallet).toBeInstanceOf(AlgoVoiAdapter)
    })

    it('exposes AlgoVoi in the wallets list', () => {
      const ids = manager.wallets.map((w) => w.id)
      expect(ids).toContain(WALLET_ID)
    })

    it('wallet starts disconnected', () => {
      const wallet = manager.getWallet(WALLET_ID)
      expect(wallet?.isConnected).toBe(false)
    })
  })

  // ── Connect flow ──────────────────────────────────────────────────────────

  describe('connect', () => {
    beforeEach(() => {
      mockProvider.enable.mockResolvedValue({ accounts: [MOCK_ADDRESS_1, MOCK_ADDRESS_2] })
    })

    it('calls window.algorand.enable() once', async () => {
      await manager.getWallet(WALLET_ID)!.connect()

      expect(mockProvider.enable).toHaveBeenCalledTimes(1)
    })

    it('wallet becomes connected after successful connect()', async () => {
      await manager.getWallet(WALLET_ID)!.connect()

      expect(manager.getWallet(WALLET_ID)!.isConnected).toBe(true)
    })

    it('returns correctly shaped account objects', async () => {
      const accounts = await manager.getWallet(WALLET_ID)!.connect()

      expect(accounts).toEqual([
        { name: 'AlgoVoi Account 1', address: MOCK_ADDRESS_1 },
        { name: 'AlgoVoi Account 2', address: MOCK_ADDRESS_2 }
      ])
    })

    it('exposes accounts via manager.activeWalletAddresses after connect', async () => {
      await manager.getWallet(WALLET_ID)!.connect()

      const addresses = manager.activeWalletAddresses
      expect(addresses).toContain(MOCK_ADDRESS_1)
    })

    it('throws when enable() is rejected and wallet stays disconnected', async () => {
      mockProvider.enable.mockRejectedValueOnce(new Error('User cancelled'))

      await expect(manager.getWallet(WALLET_ID)!.connect()).rejects.toThrow('User cancelled')
      expect(manager.getWallet(WALLET_ID)!.isConnected).toBe(false)
    })

    it('throws when enable() returns empty accounts', async () => {
      mockProvider.enable.mockResolvedValueOnce({ accounts: [] })

      await expect(manager.getWallet(WALLET_ID)!.connect()).rejects.toThrow('No accounts found!')
    })
  })

  // ── Disconnect flow ───────────────────────────────────────────────────────

  describe('disconnect', () => {
    beforeEach(async () => {
      mockProvider.enable.mockResolvedValue({ accounts: [MOCK_ADDRESS_1] })
      mockProvider.disable.mockResolvedValue(undefined)
      await manager.getWallet(WALLET_ID)!.connect()
    })

    it('calls window.algorand.disable()', async () => {
      await manager.getWallet(WALLET_ID)!.disconnect()
      expect(mockProvider.disable).toHaveBeenCalledTimes(1)
    })

    it('wallet becomes disconnected after disconnect()', async () => {
      await manager.getWallet(WALLET_ID)!.disconnect()
      expect(manager.getWallet(WALLET_ID)!.isConnected).toBe(false)
    })

    it('clears accounts from manager after disconnect()', async () => {
      await manager.getWallet(WALLET_ID)!.disconnect()
      expect(manager.activeWalletAddresses).toBeNull()
    })

    it('still disconnects cleanly if disable() throws', async () => {
      mockProvider.disable.mockRejectedValueOnce(new Error('Extension uninstalled'))

      await manager.getWallet(WALLET_ID)!.disconnect()
      expect(manager.getWallet(WALLET_ID)!.isConnected).toBe(false)
    })
  })

  // ── Sign transactions flow ────────────────────────────────────────────────

  describe('signTransactions', () => {
    /** Simulate a signed transaction returned by the extension (base64). */
    const fakeSignedB64 = btoa(String.fromCharCode(0x82, 0xa3, 0x73, 0x69, 0x67))

    beforeEach(async () => {
      mockProvider.enable.mockResolvedValue({ accounts: [MOCK_ADDRESS_1] })
      await manager.getWallet(WALLET_ID)!.connect()
    })

    it('calls window.algorand.signTransactions() with the correct structure', async () => {
      mockProvider.signTransactions.mockResolvedValueOnce([fakeSignedB64])

      const fakeTxn = {
        sender: { toString: () => MOCK_ADDRESS_1 },
        toByte: () => new Uint8Array([0x01, 0x02])
      } as never

      await manager.getWallet(WALLET_ID)!.signTransactions([fakeTxn])

      expect(mockProvider.signTransactions).toHaveBeenCalledTimes(1)
      const [txnsArg] = mockProvider.signTransactions.mock.calls[0]
      expect(Array.isArray(txnsArg)).toBe(true)
      expect(txnsArg[0]).toHaveProperty('txn')
      expect(typeof txnsArg[0].txn).toBe('string') // base64
    })

    it('returns Uint8Array results for signed transactions', async () => {
      mockProvider.signTransactions.mockResolvedValueOnce([fakeSignedB64])

      const fakeTxn = {
        sender: { toString: () => MOCK_ADDRESS_1 },
        toByte: () => new Uint8Array([0x01, 0x02])
      } as never

      const result = await manager.getWallet(WALLET_ID)!.signTransactions([fakeTxn])
      expect(result[0]).toBeInstanceOf(Uint8Array)
    })

    it('returns null for transactions the wallet skips', async () => {
      mockProvider.signTransactions.mockResolvedValueOnce([null])

      const fakeTxn = {
        sender: { toString: () => 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
        toByte: () => new Uint8Array([0x01, 0x02])
      } as never

      const result = await manager.getWallet(WALLET_ID)!.signTransactions([fakeTxn])
      expect(result[0]).toBeNull()
    })

    it('marks foreign transactions with signers: []', async () => {
      mockProvider.signTransactions.mockResolvedValueOnce([fakeSignedB64, null])

      const ownTxn = {
        sender: { toString: () => MOCK_ADDRESS_1 },
        toByte: () => new Uint8Array([0x01])
      } as never
      const foreignTxn = {
        sender: { toString: () => 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
        toByte: () => new Uint8Array([0x02])
      } as never

      await manager.getWallet(WALLET_ID)!.signTransactions([ownTxn, foreignTxn])

      const [txnsArg] = mockProvider.signTransactions.mock.calls[0]
      expect(txnsArg[0].signers).toBeUndefined()     // own txn — wallet signs
      expect(txnsArg[1].signers).toEqual([])          // foreign txn — wallet skips
    })

    it('propagates signing errors from the extension', async () => {
      mockProvider.signTransactions.mockRejectedValueOnce(new Error('User rejected'))

      const fakeTxn = {
        sender: { toString: () => MOCK_ADDRESS_1 },
        toByte: () => new Uint8Array([0x01])
      } as never

      await expect(
        manager.getWallet(WALLET_ID)!.signTransactions([fakeTxn])
      ).rejects.toThrow('User rejected')
    })
  })

  // ── Provider detection ────────────────────────────────────────────────────

  describe('provider detection', () => {
    it('detects a provider injected via algorand#initialized event', async () => {
      removeProvider()
      // @ts-expect-error reset cached provider reference so detection runs again
      manager.getWallet(WALLET_ID)!._provider = null

      // Simulate late injection (extension content script fires after page load)
      setTimeout(() => {
        installProvider()
        window.dispatchEvent(new Event('algorand#initialized'))
      }, 50)

      mockProvider.enable.mockResolvedValue({ accounts: [MOCK_ADDRESS_1] })
      const accounts = await manager.getWallet(WALLET_ID)!.connect()

      expect(accounts[0].address).toBe(MOCK_ADDRESS_1)
    })

    it('times out with a clear error when no extension is present', async () => {
      removeProvider()

      // Bypass the global manager — use a very short timeout so the test is fast
      const shortManager = new WalletManager({
        wallets: [algovoi({ timeout: 50 })]
      })

      await expect(shortManager.getWallet(WALLET_ID)!.connect()).rejects.toThrow(
        'AlgoVoi extension not detected'
      )

      await shortManager.disconnect()
    }, 3000)
  })
})

// Tiny helper so the constant is available inside the test file without re-import
const WALLET_ID = 'algovoi'
