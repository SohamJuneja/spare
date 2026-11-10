// Nimiq user-friendly address codec (IBAN-style, custom base32). Pure, no deps.

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'

/** Canonical form: upper-case, single spaces every 4 chars. */
export function normalizeAddress(address: string): string {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})(?=.)/g, '$1 ')
}

function ibanCheck(str: string): number {
  const num = str
    .split('')
    .map((c) => {
      const code = c.toUpperCase().charCodeAt(0)
      return code >= 48 && code <= 57 ? c : (code - 55).toString()
    })
    .join('')
  let tmp = ''
  for (let i = 0; i < Math.ceil(num.length / 6); i++) {
    tmp = (parseInt(tmp + num.substr(i * 6, 6), 10) % 97).toString()
  }
  return parseInt(tmp, 10)
}

function toBase32(bytes: Uint8Array): string {
  let shift = 3
  let carry = 0
  let out = ''
  for (const byte of bytes) {
    let symbol = carry | (byte >> shift)
    out += ALPHABET[symbol & 0x1f]
    if (shift > 5) {
      shift -= 5
      symbol = byte >> shift
      out += ALPHABET[symbol & 0x1f]
    }
    shift = 5 - shift
    carry = byte << shift
    shift = 8 - shift
  }
  if (shift !== 3) out += ALPHABET[carry & 0x1f]
  return out
}

/** 20-byte hex (40 chars) -> "NQxx xxxx ..." */
export function addressFromHex(hex: string): string {
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) throw new Error(`Invalid address hex: ${hex}`)
  const bytes = new Uint8Array(20)
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  const base32 = toBase32(bytes)
  const check = ('00' + (98 - ibanCheck(base32 + 'NQ00'))).slice(-2)
  return normalizeAddress('NQ' + check + base32)
}

export function isValidAddress(address: string): boolean {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  if (!/^NQ[0-9]{2}[0-9A-HJ-NP-VXY]{32}$/.test(compact)) return false
  return ibanCheck(compact.substring(4) + compact.substring(0, 4)) === 1
}
