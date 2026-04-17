import { Tool } from "./tool"
import { BashTool } from "./bash"

export const PowerShellTool = Tool.define("powershell", async () => {
  const tool = await BashTool.init()
  return {
    ...tool,
    description:
      "Execute a PowerShell command in the current project environment. On Windows this uses the native PowerShell shell.",
  }
})
