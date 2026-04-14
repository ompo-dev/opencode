import { $ } from "bun"
import path from "node:path"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(path.resolve(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`))

async function build() {
  await (sidecarConfig.ocBinary.includes("-baseline")
    ? $`cd ../opencode && bun run build --single --baseline --skip-install --skip-embed-web-ui`
    : $`cd ../opencode && bun run build --single --skip-install --skip-embed-web-ui`)
}

await build()
await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
