const crypto = require('crypto')
const { TUNNEL_AES_KEY } = require('../config')

// Clé 256 bits hex (64 caractères)
const KEY = Buffer.from(TUNNEL_AES_KEY, 'hex')
const ALGO = 'aes-256-gcm'
const IV_LEN = 12      // 12 octets pour GCM
const TAG_LEN = 16     // 16 octets tag

// Chiffre un buffer, retourne Buffer [IV][DATA][TAG]
function encrypt(plainBuf) {
    const iv = crypto.randomBytes(IV_LEN)
    const cipher = crypto.createCipheriv(ALGO, KEY, iv)
    const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format : IV + DATA + TAG
    return Buffer.concat([iv, encrypted, tag])
}

// Déchiffre un buffer format [IV][DATA][TAG], retourne Buffer plain
function decrypt(payloadBuf) {
    const iv = payloadBuf.slice(0, IV_LEN)
    const tag = payloadBuf.slice(-TAG_LEN)
    const enc = payloadBuf.slice(IV_LEN, -TAG_LEN)
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
}

module.exports = { encrypt, decrypt }
