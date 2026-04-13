import { $ } from "bun"
import path from "node:path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

async function clear() {
  if (process.platform !== "win32") return

  const file = path.resolve("src-tauri/target/debug/opencode-cli.exe")
  const proc = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$p = '${file.replaceAll("'", "''")}'; Get-CimInstance Win32_Process -Filter "Name = 'opencode-cli.exe'" | Where-Object { $_.ExecutablePath -eq $p } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  )

  if ((await proc.exited) !== 0) throw new Error("failed to stop stale desktop sidecar")
}

await clear()

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline`
  : $`cd ../opencode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
