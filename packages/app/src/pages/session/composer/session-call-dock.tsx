import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Index, Show } from "solid-js"
import { useSettings } from "@/context/settings"
import { voiceCall } from "@/context/voice-call"

const clock = (value: number) => {
  const next = Math.max(0, Math.round(value / 1000))
  const min = Math.floor(next / 60)
  const sec = String(next % 60).padStart(2, "0")
  return `${min}:${sec}`
}

const label = (value: typeof voiceCall.state.phase) => {
  if (value === "warming") return "Preparando voz"
  if (value === "connecting") return "Conectando microfone"
  if (value === "listening") return "Ouvindo"
  if (value === "user_speaking") return "Voce falando"
  if (value === "user_processing") return "Transcrevendo"
  if (value === "assistant_thinking") return "IA pensando"
  if (value === "assistant_speaking") return "IA falando"
  if (value === "interrupted") return "Interrompida"
  if (value === "error") return "Erro"
  return "Pronto"
}

function Wave(props: { items: number[]; tone: "user" | "assistant" }) {
  return (
    <div class="flex h-14 items-center gap-[3px] overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-base px-3">
      <Index each={props.items}>
        {(item) => (
          <div
            class="min-w-0 flex-1 rounded-full transition-all"
            style={{
              height: `${Math.max(16, Math.round(20 + item() * 34))}px`,
              "background-color":
                props.tone === "user" ? "var(--icon-success-base)" : "var(--icon-warning-base)",
              opacity: `${props.tone === "user" ? 0.32 + item() * 0.68 : 0.24 + item() * 0.76}`,
            }}
          />
        )}
      </Index>
    </div>
  )
}

export function SessionCallDock(props: {
  call: {
    active: () => boolean
    start: () => Promise<void> | void
    stop: () => Promise<void> | void
    toggle: () => Promise<void> | void
  }
}) {
  const settings = useSettings()
  const open = () => settings.voice.mode() === "call" || voiceCall.state.active || voiceCall.state.phase !== "idle"

  return (
    <Show when={open()}>
      <div class="pb-2">
        <div class="overflow-hidden rounded-[16px] border border-border-weak-base bg-surface-base shadow-sm">
          <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-14-medium text-text-strong">
                <Icon name="mic" class="size-4" />
                <span>Call</span>
                <span class="rounded-full bg-surface-raised-base px-2 py-0.5 text-11-medium text-text-weak">
                  {label(voiceCall.state.phase)}
                </span>
              </div>
              <div class="pt-1 text-12-regular text-text-weak">
                {voiceCall.state.error || "Conversa por voz em tempo real com interrupcao e transcricao ao vivo."}
              </div>
            </div>
            <div class="flex items-center gap-3">
              <div class="text-12-medium text-text-weak">{clock(voiceCall.state.elapsed_ms)}</div>
              <div class="flex items-center gap-2 text-12-regular text-text-weak">
                <span>Mudo</span>
                <Switch checked={settings.voice.mute()} onChange={(value) => settings.voice.setMute(value)} />
              </div>
              <Button size="small" variant={props.call.active() ? "secondary" : "primary"} onClick={() => props.call.toggle()}>
                {props.call.active() ? "Encerrar" : "Iniciar"}
              </Button>
            </div>
          </div>

          <div class="grid gap-3 px-4 py-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between text-12-medium text-text-weak">
                <span>Voce</span>
                <span>{voiceCall.state.vad === "idle" ? "silencio" : voiceCall.state.vad}</span>
              </div>
              <Wave items={voiceCall.state.user_wave} tone="user" />
              <div class="min-h-12 rounded-[12px] border border-border-weak-base bg-background-strong px-3 py-2 text-13-regular text-text-strong">
                {voiceCall.state.user_partial || "Fale normalmente. Uma pausa media fecha o turno e envia para a IA."}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between text-12-medium text-text-weak">
                <span>IA</span>
                <span>{voiceCall.state.pending_tts > 0 ? `${voiceCall.state.pending_tts} na fila` : "sem fila"}</span>
              </div>
              <Wave items={voiceCall.state.assistant_wave} tone="assistant" />
              <div class="min-h-12 rounded-[12px] border border-border-weak-base bg-background-strong px-3 py-2 text-13-regular text-text-strong">
                {voiceCall.state.assistant_partial || "A resposta falada aparece aqui enquanto o texto tambem segue no chat."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
