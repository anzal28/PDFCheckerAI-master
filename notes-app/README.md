# Jotter – automatic AI meeting notes (PWA + small server)

Tap the mic → audio is recorded in 30s segments → Whisper transcribes → AI writes title + summary. No typing.
Each person has their own account; notes and audio are private per user.

## Run
```
USERS="anzal:CHOOSE_PW,zane:CHOOSE_PW" SESSION_SECRET=<long random> \
WHISPER_KEY=<groq key> LLM_KEY=<provider key> LLM_MODEL=<abliterated model id> \
node server.js        # Node 18+, no npm install needed
```
Optional: LLM_BASE (default OpenRouter), WHISPER_BASE (default Groq), WHISPER_MODEL, WHISPER_PRICE_PER_HOUR,
LLM_PRICE_IN / LLM_PRICE_OUT ($/1M tokens), DATA_DIR, PORT, NODE_ENV=production (secure cookies; serve over HTTPS).
API keys live only on the server. Spend is tracked server-side and hard-capped at $2 (shared by both users).
Install on phone: browser menu → Add to Home Screen; desktop: install icon in Chrome/Edge.
