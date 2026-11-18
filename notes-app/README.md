# Jotter – Granola-style AI meeting notes (PWA)

Jot rough notes + record live transcript → AI merges them into structured notes.

Run: `npx serve notes-app` (or host the folder on any HTTPS static host; mic + install need HTTPS/localhost).
Install: phone → browser menu → "Add to Home Screen"; desktop Chrome/Edge → install icon in address bar.

Transcription: audio is recorded in 30s segments, saved in IndexedDB, and sent to a Whisper endpoint (default Groq whisper-large-v3-turbo, about $0.04/hour; any OpenAI-compatible /audio/transcriptions works). Failed segments can be retried.

Settings: any OpenAI-compatible API (default OpenRouter). Enter the abliterated model id your provider hosts,
the key, and per-1M-token prices. A hard $2 cap is enforced client-side (spend tracked from API usage);
also set a limit on the key at the provider. Data and key stay in your browser's localStorage.
