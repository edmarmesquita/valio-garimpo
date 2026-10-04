import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function getEncryptionKey() {
  const encoded = process.env.MELI_TOKEN_ENCRYPTION_KEY?.trim()
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error('MELI_TOKEN_ENCRYPTION_KEY inválida ou ausente')
  }

  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('MELI_TOKEN_ENCRYPTION_KEY inválida ou ausente')
  }

  return key
}

export function assertEncryptionConfigured() {
  getEncryptionKey()
}

export function hashOpaque(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  cipher.setAAD(Buffer.from(context))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])

  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':')
}

export function decryptSecret(envelope: string, context: string) {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split(':')
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart || extra) {
    throw new Error('Credencial OAuth inválida')
  }

  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Credencial OAuth inválida')

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
