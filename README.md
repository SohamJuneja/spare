# Spare

A Nimiq Pay Mini App (Mini Apps Competition Cycle III, Save track). Spare reads your past spending from the chain, rounds each payment up to the next whole unit of your fiat currency, and lets you sweep the spare change into your own NIM stake.

Status: task 1, which covers the scaffold, the host wrapper and the chain-history engine. The page is a debug view only.

## Run

```bash
npm install
npm run dev                         # http://<LAN IP>:5173 — open this URL in Nimiq Pay > Mini Apps
npm test
npm run build
npx tsx scripts/trace.ts "NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V" 30
npx tsx scripts/capture-fixtures.ts # re-capture raw RPC fixtures in tests/fixtures/
```

Outside Nimiq Pay the app shows "Open in Nimiq Pay". You can still paste any NQ address to read its spending (read-only).

## How spending is detected

Nimiq Pay keeps spendable NIM in an HTLC "vault" co-signed by Nimiq Pay. Spare treats an HTLC as one of the user's vaults when the data in its creation tx (`recipientData`) has these values:

- sender (refund address) = the wallet
- hashRoot = 32 zero bytes (blake2b, hashCount 1)

The recipient is the shared Nimiq Pay cosigner (`NQ32 7HKC…` on mainnet).

Vaults are found recursively from the wallet's history and from each vault's history. Every tx sent from the wallet or a vault is then classified:

| kind | rule |
| --- | --- |
| failed | `executionResult === false` |
| staking | to the staking contract `NQ77 0000 … 0001` / toType 3 |
| internal | to the wallet, to a known vault, into a new vault, or into a swap HTLC that later refunded to the user |
| lightning | into any other HTLC (Nimiq Pay swap HTLCs: sha256 lock, recipient is the swap service) |
| fee-only | value 0 |
| payment | anything else |

Only `payment` and `lightning` count as spending.

The public RPC (`rpc.nimiqwatch.com`) allows 20 requests per ~10s window per IP (measured). The client keeps its own budget of 15 requests per 10.5s, caps concurrency at 2, and waits out a 429 before its single retry.

## Cache

`src/chain/cache.ts` wraps localStorage, falling back to memory, under the key `${network}:${wallet}`. It stores compact tx rows and the newest hash for each address, the discovered swap statuses and the excluded/swept spends.

On refresh, each live address is paged with 25 rows at a time only until the cached newest hash appears. Vaults past their timeout whose balance has reached 0 (computed from their full history) are final and are never fetched again. Settled swaps are cached too.

## Prices

- **NIM/USD daily and now:** DefiLlama `coins.llama.fi` (`coingecko:nimiq-2`), with CoinGecko `nimiq-2` as the fallback. The CoinGecko id `nimiq` is a dead 2019 listing.
- **CRC/GMD:** CoinGecko has no CRC/GMD quotes, so non-USD fiats go through USD × [fawazahmed0 currency-api](https://github.com/fawazahmed0/exchange-api) daily FX snapshots.
- Every source sends CORS `*`. Prices are cached in the same store.
- A missing day uses the nearest day's price and is flagged.

## Round-ups

`src/roundup.ts` (pure):

- `roundUp = ceil(fiat/step)×step − fiat`, capped at the payment's own fiat value, then multiplied (×1–×3).
- `getSweepQuote()` sums pending items and converts them to floored integer luna at the current price.

Run `npx tsx scripts/quote.ts "<NQ address>" CRC` for the full CLI view.

## Credits

[NimBooks](https://github.com/subimpact/nimbooks) (MIT) was named as a reference for HTLC flows. Spare's vault and HTLC logic was derived from live mainnet data, and no NimBooks code was copied or adapted. Reading NimBooks' price code is how we learned that `nimiq-2` is the right CoinGecko id and that DefiLlama serves its daily history. Spare's price code is its own.

Built with the official Nimiq `mini-apps` AI skill (`npx skills add nimiq/developer-center --skill mini-apps`).

## License

MIT © Soham Juneja
