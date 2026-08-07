/**
 * Smoke tests — verify the package API surface is correct without
 * exercising any real wallet or algod connection.
 */

import { algovoi, AlgoVoiAdapter, WALLET_ID } from './index'
import type { WalletAdapterConfig } from '@txnlab/use-wallet'

describe('Package API surface', () => {
  // ── Exports ──────────────────────────────────────────────────────────────

  it('exports WALLET_ID as "algovoi"', () => {
    expect(WALLET_ID).toBe('algovoi')
  })

  it('exports AlgoVoiAdapter class', () => {
    expect(AlgoVoiAdapter).toBeDefined()
    expect(typeof AlgoVoiAdapter).toBe('function')
  })

  it('exports algovoi() factory function', () => {
    expect(algovoi).toBeDefined()
    expect(typeof algovoi).toBe('function')
  })

  // ── algovoi() factory ────────────────────────────────────────────────────

  describe('algovoi() factory', () => {
    it('returns an object with id = "algovoi"', () => {
      const config = algovoi()
      expect(config.id).toBe('algovoi')
    })

    it('returns an object with the correct metadata', () => {
      const config = algovoi()
      expect(config.metadata.name).toBe('AlgoVoi')
      expect(config.metadata.icon).toMatch(/^data:image\/svg\+xml;base64,/)
    })

    it('returns an Adapter constructor', () => {
      const config = algovoi()
      expect(typeof config.Adapter).toBe('function')
    })

    it('passes options through to the config', () => {
      const config = algovoi({ timeout: 30_000 })
      expect((config as WalletAdapterConfig & { options?: { timeout?: number } }).options?.timeout)
        .toBe(30_000)
    })

    it('returns undefined options when called with no arguments', () => {
      const config = algovoi()
      expect(config.options).toBeUndefined()
    })
  })

  // ── AlgoVoiAdapter static ─────────────────────────────────────────────────

  describe('AlgoVoiAdapter.defaultMetadata', () => {
    it('has name "AlgoVoi"', () => {
      expect(AlgoVoiAdapter.defaultMetadata.name).toBe('AlgoVoi')
    })

    it('has a valid SVG data URI icon', () => {
      const { icon } = AlgoVoiAdapter.defaultMetadata
      expect(icon).toMatch(/^data:image\/svg\+xml;base64,/)
      // Verify it decodes to an SVG
      const decoded = atob(icon.replace('data:image/svg+xml;base64,', ''))
      expect(decoded).toContain('<svg')
      expect(decoded).toContain('</svg>')
    })
  })
})
