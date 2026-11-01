/* Публичная конфигурация клиента. Anon key предназначен для браузера; безопасность обеспечивается RLS. */
window.SCBB_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://otsuvtcxnbdxrodayeta.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90c3V2dGN4bmJkeHJvZGF5ZXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NjkyMzQsImV4cCI6MjEwNTQ0NTIzNH0.fsS73p3tRcbe0JIeRVjeqPStFzRe0lMKGLJQm7ki8oA',
  GITHUB_OWNER: "NasDail",
  GITHUB_REPO: "SibCodeBox",
  GITHUB_BRANCH: "main",
  GAMES_ROOT: "games",
  SYNC_INTERVAL_MS: 24 * 60 * 60 * 1000,
  MAX_GAME_BYTES: 4 * 1024 * 1024,
  DEFAULT_STOP_WORDS: ["хуй", "пизд", "еб", "бляд", "сука", "fuck", "shit", "bitch"]
});
