const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const output = mkdtempSync(join(tmpdir(), 'deskapi-test-'))
try {
  const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--target', 'ES2022', '--module', 'Node16', '--moduleResolution', 'Node16', '--strict', '--esModuleInterop', '--skipLibCheck', '--outDir', output, '--rootDir', 'src', 'src/main/serial-device.ts', 'src/main/recorder.ts', 'src/shared/tap-procedure.ts', 'src/shared/calibration.ts', 'src/main/keyboard-input.ts', 'src/main/config.ts', 'src/renderer/src/useConfig.ts', 'src/shared/ipc.ts'], { stdio: 'inherit' })
  if (compile.status !== 0) process.exitCode = compile.status || 1
  else {
    const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', 'tests/serial.cjs', 'tests/calibration.cjs', 'tests/hotkeys.cjs', 'tests/protocols.cjs', 'tests/detector.cjs', 'tests/xiao-stream.cjs', 'tests/use-config.cjs'], { stdio: 'inherit', env: { ...process.env, DESKAPI_TEST_OUTPUT: output, NODE_PATH: join(process.cwd(), 'node_modules') } })
    process.exitCode = result.status ?? 1
  }
} finally { rmSync(output, { recursive: true, force: true }) }
