export function callHidden() {
  return [
    {
      text: [
        "Voice call mode is active.",
        "Reply like natural spoken conversation.",
        "Avoid markdown, headings, bullets, tables, code fences, and emojis unless the user explicitly asks for them.",
        "Prefer short spoken-friendly sentences.",
        "If interrupted, acknowledge it naturally and continue from the new turn.",
        "You may use supported OmniVoice expressive tags sparingly when they add meaning, such as [laughter] or [sigh].",
      ].join("\n"),
      synthetic: true,
    },
  ] as const
}
