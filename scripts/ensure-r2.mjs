#!/usr/bin/env node
// Ensures R2 buckets named in wrangler.toml exist before deploy.
// Unlike D1, R2 bindings use bucket names only (no id rewrite needed).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const configPath = arg('config', 'wrangler.toml')

function runWrangler(args) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  try {
    return execFileSync('wrangler', args, options)
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        return execFileSync('npx', ['wrangler', ...args], options)
      } catch (npxError) {
        const detail = `${npxError.stderr ?? ''}${npxError.stdout ?? ''}`.trim()
        const err = new Error(`wrangler ${args.join(' ')} failed:\n${detail || npxError.message}`)
        err.detail = detail
        throw err
      }
    }
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim()
    const err = new Error(`wrangler ${args.join(' ')} failed:\n${detail || error.message}`)
    err.detail = detail
    throw err
  }
}

/** Collect unique bucket_name / preview_bucket_name from all [[r2_buckets]] blocks. */
function readBucketNames(text) {
  const names = new Set()
  let searchFrom = 0
  while (true) {
    const header = text.indexOf('[[r2_buckets]]', searchFrom)
    if (header === -1) break
    const rest = text.slice(header + '[[r2_buckets]]'.length)
    const nextHeader = rest.search(/^\s*\[/m)
    const end =
      nextHeader === -1 ? text.length : header + '[[r2_buckets]]'.length + nextHeader
    const body = text.slice(header, end)
    for (const key of ['bucket_name', 'preview_bucket_name']) {
      const value = body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]
      if (value?.trim()) names.add(value.trim())
    }
    searchFrom = end
  }
  return [...names]
}

function alreadyExists(detail) {
  return /already exists|duplicate|name is already taken/i.test(detail)
}

function ensureBucket(name) {
  try {
    runWrangler(['r2', 'bucket', 'create', name])
    console.log(`[ensure-r2] created bucket "${name}"`)
  } catch (error) {
    const detail = error.detail ?? error.message ?? ''
    if (alreadyExists(detail)) {
      console.log(`[ensure-r2] bucket "${name}" already exists`)
      return
    }
    throw error
  }
}

function main() {
  const source = readFileSync(configPath, 'utf8')
  const names = readBucketNames(source)
  if (names.length === 0) {
    console.log(`[ensure-r2] ${configPath}: no [[r2_buckets]] names — skip`)
    return
  }

  for (const name of names) {
    ensureBucket(name)
  }
  console.log(`[ensure-r2] ready: ${names.join(', ')}`)
}

try {
  main()
} catch (error) {
  console.error(`[ensure-r2] ${error.message}`)
  console.error(
    '[ensure-r2] Deploys need Cloudflare credentials with R2 edit access: set CLOUDFLARE_API_TOKEN\n' +
      '            (or run `wrangler login`), then retry. Or create buckets manually:\n' +
      '            wrangler r2 bucket create mankr-flarepost-attachments\n' +
      '            wrangler r2 bucket create mankr-flarepost-attachments-preview',
  )
  process.exit(1)
}
