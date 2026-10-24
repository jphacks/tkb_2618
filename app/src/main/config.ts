import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../shared/constants'
import { isConfig } from '../shared/validation'
import type { Config } from '../shared/types'

export class ConfigStore {
  private queue: Promise<void> = Promise.resolve()
  private value: Config = structuredClone(DEFAULT_CONFIG)
  constructor(private readonly directory: string) {}
  get config(): Config { return structuredClone(this.value) }
  async load(): Promise<Config> {
    await mkdir(this.directory, { recursive: true })
    const file = join(this.directory, 'config.json')
    let raw: string
    try { raw = await readFile(file, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.save(this.value)
      return this.config
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isConfig(parsed)) throw new Error('設定の形式が正しくありません')
      this.value = parsed
    } catch {
      await rename(file, join(this.directory, `config.broken-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))
      await this.save(this.value)
    }
    return this.config
  }
  save(value: Config): Promise<void> {
    if (!isConfig(value)) return Promise.reject(new Error('設定の形式が正しくありません'))
    const snapshot = structuredClone(value)
    return this.enqueue(() => snapshot)
  }
  /** Evaluate runtime mutations only after earlier renderer writes have finished. */
  update(change: (config: Config) => Config): Promise<void> {
    return this.enqueue(() => change(this.config))
  }
  private enqueue(next: () => Config): Promise<void> {
    const operation = this.queue.then(async () => {
      const snapshot = structuredClone(next())
      if (!isConfig(snapshot)) throw new Error('設定の形式が正しくありません')
      const file = join(this.directory, 'config.json')
      await writeFile(`${file}.tmp`, JSON.stringify(snapshot, null, 2), 'utf8')
      await rename(`${file}.tmp`, file)
      this.value = snapshot
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  async flush(): Promise<void> { await this.queue }
}
