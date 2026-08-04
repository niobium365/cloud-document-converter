import { execa } from 'execa'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { e2eExtensionKey } from './extension'

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionPath = resolve(extensionRoot, 'dist')
const cdpPort = process.env.FEISHU_E2E_CDP_PORT ?? '9223'
const localEnvPath = resolve(extensionRoot, '.e2e/feishu.env')

const localEnv = existsSync(localEnvPath)
  ? Object.fromEntries(
      readFileSync(localEnvPath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          const separator = line.indexOf('=')
          return [line.slice(0, separator), line.slice(separator + 1)]
        }),
    )
  : {}
const startUrl =
  process.env.FEISHU_E2E_WIKI_URL ??
  localEnv.FEISHU_E2E_WIKI_URL ??
  'https://www.feishu.cn/drive/home/'

if (!existsSync(resolve(extensionPath, 'manifest.json'))) {
  throw new Error('Extension build is missing. Run pnpm run build:dev first.')
}

if (process.platform !== 'linux') {
  throw new Error('This command is for a WSL2 workspace controlling Windows Chrome.')
}

const { stdout: windowsDistPath } = await execa('wslpath', [
  '-w',
  extensionPath,
])
const escapedDistPath = windowsDistPath.replace(/'/g, "''")
const escapedKey = e2eExtensionKey.replace(/'/g, "''")
const escapedStartUrl = startUrl.replace(/'/g, "''")

await execa('powershell.exe', [
  '-NoProfile',
  '-Command',
  [
    '$chrome = Join-Path $env:LOCALAPPDATA "CloudDocumentConverterE2ETools\\chrome-win64\\chrome.exe"',
    '$profile = Join-Path $env:LOCALAPPDATA "CloudDocumentConverterE2ECft"',
    '$taskName = "CloudDocumentConverterE2E"',
    '$source = \'${escapedDistPath}\'',
    '$extension = Join-Path $profile "extension"',
    'if (!(Test-Path $chrome)) { throw "Chrome for Testing is missing at $chrome" }',
    'New-Item -ItemType Directory -Force -Path $profile | Out-Null',
    '$manifestPath = Join-Path $extension "manifest.json"',
    '$previousVersion = if (Test-Path $manifestPath) { (Get-Content -Path $manifestPath -Raw | ConvertFrom-Json).version } else { "" }',
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -match "CloudDocumentConverterE2ECft" -and $_.CommandLine -notmatch "--type=" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    'Copy-Item -Path (Join-Path $source "*") -Destination $extension -Recurse -Force',
    '$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json',
    '$sequence = if ($previousVersion -match "^9\\.9\\.9\\.(\\d+)$") { [int]$Matches[1] + 1 } else { 1 }',
    '$manifest.version = "9.9.9.$sequence"',
    `$manifest | Add-Member -NotePropertyName key -NotePropertyValue '${escapedKey}' -Force`,
    '$manifest | ConvertTo-Json -Depth 100 -Compress | Set-Content -Path $manifestPath -NoNewline',
    `$arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort} --remote-allow-origins=http://localhost:${cdpPort} --user-data-dir=$profile --no-first-run --no-default-browser-check --new-window --disable-extensions-except=$extension --load-extension=$extension '${escapedStartUrl}'"`,
    '$action = New-ScheduledTaskAction -Execute $chrome -Argument $arguments',
    '$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 12)',
    'Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null',
    'Start-ScheduledTask -TaskName $taskName',
  ].join('; '),
])

const cdpUrl = `http://127.0.0.1:${cdpPort}`
const deadline = Date.now() + 15_000
while (true) {
  try {
    const response = await fetch(new URL('/json/version', cdpUrl))
    if (response.ok) break
  } catch {
    // Chrome for Testing is still starting in the interactive Windows session.
  }

  if (Date.now() >= deadline) {
    throw new Error(`Chrome for Testing did not expose CDP at ${cdpUrl}`)
  }
  await new Promise(resolve => setTimeout(resolve, 250))
}

console.log(
  `Windows Chrome for Testing is ready at ${cdpUrl}.`,
)
