# @algovoi/use-wallet-algovoi

[![npm](https://img.shields.io/npm/v/@algovoi/use-wallet-algovoi)](https://www.npmjs.com/package/@algovoi/use-wallet-algovoi)

AlgoVoi wallet adapter for [`@txnlab/use-wallet`](https://github.com/TxnLab/use-wallet) v5.

Connects the [AlgoVoi browser extension](https://algovoi.co.uk) to any use-wallet
application. The AlgoVoi extension injects an ARC-0027 compliant provider at
`window.algorand`; this adapter wraps it in the use-wallet v5 adapter model.

## Installation

```bash
npm install @algovoi/use-wallet-algovoi
```

This package has peer dependencies on `@txnlab/use-wallet` (v5) and `algosdk` (v3):

```bash
npm install @txnlab/use-wallet algosdk
```

## Usage

Register the adapter with the `WalletManager` like any other v5 wallet:

```ts
import { WalletManager, NetworkId } from '@txnlab/use-wallet'
import { algovoi } from '@algovoi/use-wallet-algovoi'

const manager = new WalletManager({
  wallets: [
    algovoi()
  ],
  defaultNetwork: NetworkId.MAINNET
})
```

The same `algovoi()` factory works with every use-wallet framework binding
(`@txnlab/use-wallet-react`, `-vue`, `-solid`, `-svelte`).

## Exports

| Export           | Description                                                         |
| ---------------- | ------------------------------------------------------------------- |
| `algovoi()`      | Factory returning a `WalletAdapterConfig` for the `WalletManager`.  |
| `AlgoVoiAdapter` | The adapter class (extends `BaseWallet`), exported for advanced use.|
| `WALLET_ID`      | The `'algovoi'` wallet id constant.                                 |

## How it works

- On `connect`, the adapter waits for the AlgoVoi provider to be injected
  (`window.algorand`, signalled by the `algorand#initialized` event), then calls
  the ARC-0027 `enable()` method to obtain accounts.
- On `signTransactions`, transaction groups are normalised and forwarded to the
  provider's `signTransactions()` method; base64 results are decoded back to
  `Uint8Array`.
- `resumeSession` restores a previously connected session from the use-wallet
  store without prompting the user again.

## Development

```bash
npm install
npm run build      # tsdown
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## License

[MIT](./LICENSE) © AlgoVoi
