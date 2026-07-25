#!/usr/bin/env node
// Resolves the real D1 database id for deploys and writes a deploy-only copy of
// the Wrangler config. The committed config keeps an all-zero placeholder id so
// the Deploy to Cloudflare button can provision a fresh database per user.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const configPath = arg('config', 'wrangler.toml')
const outPath = arg('out', 'wrangler.deploy.toml')

function isRealId(value) {
  return typeof value === 'string' && UUID_RE.test(value) && value !== PLACEHOLDER_ID
}

function runWrangler(args) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  try {
    return execFileSync('wrangler', args, options)
  } catch (error) {
    if (error.code === 'ENOENT') return execFileSync('npx', ['wrangler', ...args], options)
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim()
    const failure = new Error(`wrangler ${args.join(' ')} failed:\n${detail || error.message}`)
    failure.credentialsHint = true
    throw failure
  }
}

// Wrangler may print a banner before the JSON payload.
function parseJsonLoose(text) {
  const start = text.search(/[[{]/)
  if (start === -1) throw new Error(`no JSON in wrangler output:\n${text}`)
  const body = text.slice(start)
  for (let end = body.length; end > 0; end = body.lastIndexOf(body[0] === '[' ? ']' : '}', end - 1)) {
    try {
      return JSON.parse(body.slice(0, end + 1))
    } catch {
      if (end <= 1) break
    }
  }
  throw new Error(`unparsable wrangler output:\n${text}`)
}

function unwrap(payload) {
  return payload && typeof payload === 'object' && 'result' in payload ? payload.result : payload
}

// The block runs from `[[d1_databases]]` to the next table header.
function readD1Block(text) {
  const header = text.indexOf('[[d1_databases]]')
  if (header === -1) throw new Error(`${configPath} has no [[d1_databases]] entry`)
  const rest = text.slice(header + '[[d1_databases]]'.length)
  const nextHeader = rest.search(/^\s*\[/m)
  const end = nextHeader === -1 ? text.length : header + '[[d1_databases]]'.length + nextHeader
  return { start: header, end, body: text.slice(header, end) }
}

function tomlValue(body, key) {
  return body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]
}

function listDatabases() {
  const databases = unwrap(parseJsonLoose(runWrangler(['d1', 'list', '--json'])))
  return Array.isArray(databases) ? databases : []
}

function resolveId(databaseName, configuredId) {
  if (isRealId(process.env.D1_DATABASE_ID)) {
    return { id: process.env.D1_DATABASE_ID, origin: 'D1_DATABASE_ID env var' }
  }
  if (isRealId(configuredId)) {
    return { id: configuredId, origin: configPath }
  }
  const databases = listDatabases()
  const existing = databases.find((db) => db?.name === databaseName)?.uuid
  if (existing) return { id: existing, origin: `existing D1 "${databaseName}"` }

  // Creating a fresh database when the account already has others usually means
  // database_name drifted (e.g. renamed in config only) — deploying against a new
  // empty database would look exactly like data loss, so require an explicit opt-in.
  if (databases.length > 0 && process.env.D1_ALLOW_CREATE !== '1') {
    const names = databases.map((db) => `${db?.name} (${db?.uuid})`).join('\n              ')
    throw new Error(
      `no D1 named "${databaseName}" in this account, but these exist:\n              ${names}\n` +
        'Refusing to create an empty database. Point database_name at the right one, or set\n' +
        'D1_DATABASE_ID=<id>, or pass D1_ALLOW_CREATE=1 if a brand-new database is intended.',
    )
  }

  runWrangler(['d1', 'create', databaseName])
  const created = listDatabases().find((db) => db?.name === databaseName)?.uuid
  if (!created) throw new Error(`created D1 "${databaseName}" but could not read back its id`)
  return { id: created, origin: `newly created D1 "${databaseName}"` }
}

function main() {
  const source = readFileSync(configPath, 'utf8')
  const block = readD1Block(source)
  const databaseName = tomlValue(block.body, 'database_name')
  if (!databaseName) throw new Error(`${configPath} [[d1_databases]] has no database_name`)

  const { id, origin } = resolveId(databaseName, tomlValue(block.body, 'database_id'))
  const patchedBlock = /^\s*database_id\s*=/m.test(block.body)
    ? block.body.replace(/^(\s*database_id\s*=\s*).*$/m, `$1"${id}"`)
    : block.body.replace(/^(\s*binding\s*=.*)$/m, `$1\ndatabase_id = "${id}"`)

  writeFileSync(outPath, source.slice(0, block.start) + patchedBlock + source.slice(block.end))
  console.log(`[ensure-d1] ${outPath}: database_id from ${origin}`)
}

try {
  main()
} catch (error) {
  console.error(`[ensure-d1] ${error.message}`)
  if (error.credentialsHint) {
    console.error(
      '[ensure-d1] This step needs Cloudflare credentials with D1 edit access: set CLOUDFLARE_API_TOKEN\n' +
        '            (or run `wrangler login`), or pass a known id via D1_DATABASE_ID.',
    )
  }
  process.exit(1)
}
