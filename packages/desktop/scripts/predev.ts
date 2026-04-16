import { $ } from "bun"
import path from "node:path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(path.resolve(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`))
const root = path.resolve("src-tauri")

async function cut() {
  if (process.platform !== "win32") return
  const hit = root.replaceAll("'", "''")
  const proc = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `$root='${hit}'; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'opencode-cli.exe' -or $_.Name -eq 'OpenCode.exe') -and $_.ExecutablePath -like "$root*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  await proc.exited
}

async function build() {
  await (sidecarConfig.ocBinary.includes("-baseline")
    ? $`cd ../opencode && bun run build --single --baseline --skip-install --skip-embed-web-ui`
    : $`cd ../opencode && bun run build --single --skip-install --skip-embed-web-ui`)
}

await cut()
await build()
await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
