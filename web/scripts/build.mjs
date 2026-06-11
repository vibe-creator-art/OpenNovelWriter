import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')

const child = spawn(process.execPath, [nextBin, 'build'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
    BROWSERSLIST_IGNORE_OLD_DATA: 'true',
  },
})

let suppressNextTraceLine = false

const shouldSuppressLine = (line) => {
  if (
    line.includes('[baseline-browser-mapping]') &&
    line.includes('The data in this module is over two months old')
  ) {
    return true
  }

  if (line.includes('--localstorage-file') && line.includes('valid path')) {
    suppressNextTraceLine = true
    return true
  }

  if (suppressNextTraceLine) {
    suppressNextTraceLine = false
    if (line.includes('node --trace-warnings')) {
      return true
    }
  }

  return false
}

const forwardStream = (stream, target) => {
  let buffer = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!shouldSuppressLine(line)) {
        target.write(`${line}\n`)
      }
    }
  })

  stream.on('end', () => {
    if (buffer && !shouldSuppressLine(buffer)) {
      target.write(buffer)
    }
  })
}

forwardStream(child.stdout, process.stdout)
forwardStream(child.stderr, process.stderr)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
