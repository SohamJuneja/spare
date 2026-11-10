// Saves raw RPC responses used by the unit tests. Usage: npx tsx scripts/capture-fixtures.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const RPC = 'https://rpc.nimiqwatch.com'
const OUT = 'tests/fixtures'

async function raw(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

const captures: [string, string, unknown[]][] = [
  // Wallet that funded Kuza's README address (which turns out to be a swap HTLC, not a vault).
  ['txs-wallet-nq04.json', 'getTransactionsByAddress', ['NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V', 500, null]],
  ['txs-vault-nq80.json', 'getTransactionsByAddress', ['NQ80 UUAS BU0Q 6Q5B 17C7 E245 DNST 92Q1 65NG', 500, null]],
  ['txs-vault-nq89-4vdf.json', 'getTransactionsByAddress', ['NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5', 500, null]],
  ['txs-swap-nq89-v0mn.json', 'getTransactionsByAddress', ['NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM', 500, null]],
  ['txs-swap-nq98-lets.json', 'getTransactionsByAddress', ['NQ98 LETS CC07 ERYV A425 MK1A KNJQ XTMT 3759', 500, null]],
  ['account-vault-htlc-nq89-4vdf.json', 'getAccountByAddress', ['NQ89 4VDF DQ8Q JEGL KX8U A1HC DE6K A78Y CJR5']],
  ['account-pruned-htlc-nq89-v0mn.json', 'getAccountByAddress', ['NQ89 V0MN CVGT 3RC9 B7PA F1YJ L564 TEMK A0TM']],
  // Busier real Nimiq Pay wallet, and one of its vaults that was funded directly by the previous vault.
  ['txs-wallet-nq51.json', 'getTransactionsByAddress', ['NQ51 DE7S FX74 A8BL L7GK EYGB YVPF UK6C 8DXT', 500, null]],
  ['txs-vault-nq22.json', 'getTransactionsByAddress', ['NQ22 6D6X JBMX 8GLY 6F3K VXTS DCMG KAFG SXKG', 500, null]],
  // Another user's vault that staked from Nimiq Pay (vault -> staking contract).
  ['txs-vault-nq91-staker.json', 'getTransactionsByAddress', ['NQ91 Q6RM DEQX 0Q0S CTRM CN3A XEQR YLH2 803M', 500, null]],
]

mkdirSync(OUT, { recursive: true })
for (const [file, method, params] of captures) {
  const body = await raw(method, params)
  writeFileSync(`${OUT}/${file}`, JSON.stringify(body, null, 2))
  console.log('saved', file)
}

// No failed tx (executionResult false) was found in ~6,000 recent staking-contract txs or the wallets above,
// so this one fixture is DERIVED: a real NQ04 vault payment with only executionResult flipped.
const vault = JSON.parse(readFileSync(`${OUT}/txs-vault-nq89-4vdf.json`, 'utf8')) as {
  result: { data: { hash: string; executionResult: boolean }[] }
}
const real = vault.result.data.find((t) => t.hash.startsWith('43dd84c6'))!
writeFileSync(
  `${OUT}/derived-failed-tx.json`,
  JSON.stringify({ _derivedFrom: real.hash, _note: 'real tx with executionResult set to false', tx: { ...real, executionResult: false } }, null, 2),
)
console.log('saved derived-failed-tx.json')
