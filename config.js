const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ENV_PATH = path.resolve(__dirname, '.env')

// Charge le .env en objet
function loadEnv() {
    if (!fs.existsSync(ENV_PATH)) return {}
    return Object.fromEntries(
        fs.readFileSync(ENV_PATH, 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'))
            .map(l => l.split('='))
            .map(([k, ...v]) => [k.trim(), v.join('=').trim()])
    )
}

// Sauve l'objet env dans .env
function saveEnv(env) {
    fs.writeFileSync(
        ENV_PATH,
        Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
    )
}

let env = loadEnv()

// TUNNEL_AES_KEY
if (!env.TUNNEL_AES_KEY || !/^[0-9a-f]{64}$/i.test(env.TUNNEL_AES_KEY)) {
    env.TUNNEL_AES_KEY = crypto.randomBytes(32).toString('hex')
    console.log('[INFO] TUNNEL_AES_KEY générée')
}

// TUNNEL_TOKEN
if (!env.TUNNEL_TOKEN || !/^wgt_[a-f0-9]{48}$/i.test(env.TUNNEL_TOKEN)) {
    env.TUNNEL_TOKEN = 'wgt_' + crypto.randomBytes(24).toString('hex')
    console.log(`[INFO] Token tunnel généré : ${env.TUNNEL_TOKEN}`)
}

// DASH_USER
if (!env.DASH_USER) {
    env.DASH_USER = 'admin'
    console.log('[INFO] DASH_USER défini : admin')
}

// DASH_PASS
if (!env.DASH_PASS) {
    env.DASH_PASS = crypto.randomBytes(12).toString('base64')
    console.log(`[INFO] DASH_PASS généré : ${env.DASH_PASS}`)
}

// LOGIN_SECRET
if (!env.LOGIN_SECRET || !/^[0-9a-f]{64}$/i.test(env.LOGIN_SECRET)) {
    env.LOGIN_SECRET = crypto.randomBytes(32).toString('hex')
    console.log('[INFO] LOGIN_SECRET généré')
}

// Persiste le tout
saveEnv(env)

// Info optionnel
console.log('[INFO] DASH_USER      =', env.DASH_USER)
console.log('[INFO] DASH_PASS      =', env.DASH_PASS)
console.log('[INFO] LOGIN_SECRET   =', env.LOGIN_SECRET)

// Exporte les valeurs prêtes à l’emploi
module.exports = {
    TUNNEL_AES_KEY: env.TUNNEL_AES_KEY.trim(),
    TUNNEL_TOKEN: env.TUNNEL_TOKEN.trim(),
    DASH_USER: env.DASH_USER.trim(),
    DASH_PASS: env.DASH_PASS.trim(),
    LOGIN_SECRET: env.LOGIN_SECRET.trim()
}
