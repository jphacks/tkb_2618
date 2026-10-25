const { SerialPort } = require('serialport')
const { createWriteStream } = require('node:fs')
const [path, baud = '115200'] = process.argv.slice(2)
if (!path || !Number.isInteger(Number(baud)) || Number(baud) <= 0) {
  console.error('Usage: npm run serial-log -- COM5 [baud]')
  process.exit(1)
}
const filename = `serial-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
const file = createWriteStream(filename, { flags: 'wx' })
const port = new SerialPort({ path, baudRate: Number(baud), dataBits: 8, stopBits: 1, parity: 'none' })
let buffer = '', stopping = false, count = 0, last = ''
function flush() {
  if (!count) return
  process.stdout.write(`[${new Date().toISOString()}] 受信 ${count} 行\n`)
  process.stdout.write(last)
  count = 0
}
const timer = setInterval(flush, 1000)
function line(value) {
  const entry = `[${new Date().toISOString()}] ${value.replace(/\r$/, '')}\n`
  file.write(entry)
  if (value.startsWith('[')) process.stdout.write(entry)
  else { count++; last = entry }
}
function stop(error) {
  if (stopping) return
  stopping = true
  if (error) { console.error(error.message); process.exitCode = 1 }
  if (buffer) { line(buffer); buffer = '' }
  if (port.isOpen) port.close()
  else port.once('open', () => port.close())
  clearInterval(timer)
  flush()
  file.end()
}
file.on('error', error => { console.error(error.message); process.exitCode = 1; port.destroy() })
port.on('error', stop)
port.on('close', () => stop())
port.on('open', () => console.log(filename))
port.on('data', chunk => {
  buffer += chunk.toString('utf8')
  let end
  while ((end = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
})
process.on('SIGINT', () => stop())
