// Saves raw staking-related responses. Usage: npx tsx scripts/capture-staking-fixtures.ts
// Kept separate from capture-fixtures.ts so re-running it never shifts the Task 1 tx histories.
import { writeFileSync } from 'node:fs'

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

const save = (file: string, body: unknown) => {
  writeFileSync(`${OUT}/${file}`, JSON.stringify(body, null, 2))
  console.log('saved', file)
}

// The wallet NQ56 R5JT staked from its vault NQ91 Q6RM (tx 40a52fd5…). The staker is the wallet.
save('staker-wallet-nq56.json', await raw('getStakerByAddress', ['NQ56 R5JT 1V5D 992A P60D 8E04 QQVN FGN7 SR3Q']))
save('staker-none-vault-nq91.json', await raw('getStakerByAddress', ['NQ91 Q6RM DEQX 0Q0S CTRM CN3A XEQR YLH2 803M']))
save('staker-none-wallet-nq04.json', await raw('getStakerByAddress', ['NQ04 HH5C HSLU VHGD EP4G BA1R 1MGB PT0X EY9V']))
save('policy-constants.json', await raw('getPolicyConstants', []))
save('tx-by-hash-staking.json', await raw('getTransactionByHash', ['40a52fd5e18ecd1183de80f19eaf5d02e08a7193412f0cd02795de1b679b94ee']))
save('tx-by-hash-not-found.json', await raw('getTransactionByHash', ['0'.repeat(64)]))

// Validators API rows, with the base64 logos stripped to keep fixtures small.
for (const net of ['main', 'test']) {
  const rows = (await (await fetch(`https://validators-api-${net}.je-cf9.workers.dev/api/v1/validators`)).json()) as Record<string, unknown>[]
  save(`validators-${net}.json`, rows.map(({ logo: _logo, ...r }) => r))
}
