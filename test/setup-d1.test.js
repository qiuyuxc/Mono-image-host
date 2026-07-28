import { describe, expect, it } from 'vitest'
import { addDatabaseId, parseDatabaseList, readD1Binding } from '../scripts/setup-d1.mjs'

describe('D1 setup', () => {
  const config = `name = "mono"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "image-host"\nmigrations_dir = "migrations"\n\n[vars]\nMAX_SIZE_MB = "20"\n`

  it('reads the database name from the configured binding', () => {
    expect(readD1Binding(config, 'DB').databaseName).toBe('image-host')
  })

  it('injects the discovered UUID without changing the tracked config', () => {
    const generated = addDatabaseId(config, 'DB', '12345678-1234-1234-1234-123456789abc')
    expect(generated).toContain('database_id = "12345678-1234-1234-1234-123456789abc"')
    expect(config).not.toContain('database_id')
  })

  it('replaces an existing UUID in generated configs', () => {
    const configWithId = config.replace('database_name = "image-host"', 'database_name = "image-host"\ndatabase_id = "old-id"')
    const generated = addDatabaseId(configWithId, 'DB', 'new-id')
    expect(generated).toContain('database_id = "new-id"')
    expect(generated).not.toContain('database_id = "old-id"')
  })

  it('parses JSON even when Wrangler includes surrounding output', () => {
    const databases = parseDatabaseList('Checking account...\n[{"uuid":"d1-id","name":"image-host"}]\n')
    expect(databases[0]).toEqual({ uuid: 'd1-id', name: 'image-host' })
  })
})
