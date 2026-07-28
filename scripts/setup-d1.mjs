import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceConfigPath = fileURLToPath(new URL('../wrangler.toml', import.meta.url))
const generatedConfigPath = fileURLToPath(new URL('../wrangler.auto.toml', import.meta.url))
const bindingName = 'DB'

export function parseDatabaseList(output) {
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '')
  const start = cleanOutput.indexOf('[')
  const end = cleanOutput.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('Wrangler 未返回可解析的 D1 列表。')

  const databases = JSON.parse(cleanOutput.slice(start, end + 1))
  if (!Array.isArray(databases)) throw new Error('Wrangler 返回了无效的 D1 列表。')
  return databases
}

export function readD1Binding(config, expectedBinding) {
  const blocks = config.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[{1,2}[^\n]+\]{1,2}|$)/g) || []
  const block = blocks.find(candidate => readTomlString(candidate, 'binding') === expectedBinding)
  if (!block) throw new Error(`wrangler.toml 中缺少 D1 绑定 ${expectedBinding}。`)

  const databaseName = readTomlString(block, 'database_name')
  if (!databaseName) throw new Error(`D1 绑定 ${expectedBinding} 缺少 database_name。`)
  return { block, databaseName }
}

export function addDatabaseId(config, expectedBinding, databaseId) {
  const { block } = readD1Binding(config, expectedBinding)
  const idLine = `database_id = "${databaseId}"`
  const updatedBlock = /^database_id\s*=/m.test(block)
    ? block.replace(/^database_id\s*=.*$/m, idLine)
    : block.replace(/^(database_name\s*=.*)$/m, `$1\n${idLine}`)
  return config.replace(block, updatedBlock)
}

function readTomlString(block, key) {
  return block.match(new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`, 'm'))?.[1]
}

function runWrangler(args, options = {}) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(command, ['wrangler', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`Wrangler 命令执行失败：wrangler ${args.join(' ')}`)
  }
  return result.stdout || ''
}

function findDatabase(databaseName) {
  const databases = parseDatabaseList(runWrangler(['d1', 'list', '--json'], { capture: true }))
  return databases.find(database => database.name === databaseName)
}

function databaseId(database) {
  return database?.uuid || database?.id
}

function prepareConfig() {
  const sourceConfig = readFileSync(sourceConfigPath, 'utf8')
  const { databaseName } = readD1Binding(sourceConfig, bindingName)
  let database = findDatabase(databaseName)

  if (!database) {
    console.log(`未找到 D1 数据库 ${databaseName}，正在自动创建...`)
    runWrangler(['d1', 'create', databaseName])
    database = findDatabase(databaseName)
  } else {
    console.log(`已找到 D1 数据库 ${databaseName}。`)
  }

  const id = databaseId(database)
  if (!id) throw new Error(`无法读取 D1 数据库 ${databaseName} 的 UUID。`)
  writeFileSync(generatedConfigPath, addDatabaseId(sourceConfig, bindingName, id))
  return { databaseName }
}

export function main(args = process.argv.slice(2)) {
  const deploy = !args.includes('--migrate-only')
  const { databaseName } = prepareConfig()

  try {
    console.log(`正在为 ${databaseName} 自动创建或更新数据表...`)
    runWrangler(['d1', 'migrations', 'apply', databaseName, '--remote', '--config', generatedConfigPath])
    if (deploy) {
      console.log('数据表已就绪，正在部署 Worker...')
      runWrangler(['deploy', '--config', generatedConfigPath])
    }
  } finally {
    rmSync(generatedConfigPath, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`\nD1 初始化失败：${error.message}`)
    process.exitCode = 1
  }
}
