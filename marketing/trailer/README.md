# Trailer (EN + TR)

Two ~30–40 s 1080p trailers built from real footage of the site, ElevenLabs voiceover and music.

| | Voice | Length |
|---|---|---|
| English | Severin (ElevenLabs) | ~38 s |
| Türkçe | Özgür Babal (ElevenLabs) | ~31 s |

## Rebuild
```bash
# 1) run the stack in mock mode with fast scoring + livelier prices
DEV_TOOLS=1 PRICE_MODE=mock MOCK_VOLATILITY=4 SHOUT_HORIZON_SEC=6 pnpm --filter @syb/api start
pnpm --filter @syb/web build && pnpm --filter @syb/web start
# 2) wait ~60 s for price history (sparklines), then film
node marketing/trailer/record.cjs        # -> raw/<shot>/frames + meta.json
python3 marketing/trailer/tomp4.py       # -> raw/<shot>/raw.mp4 + marks.json
python3 marketing/trailer/build.py       # -> out/shoutyourbet-trailer-{en,tr}.mp4
```
Needs Playwright (Chromium) and ffmpeg. Audio in `audio/` is already generated; edit `script.json` and regenerate a line via the ElevenLabs TTS API (`eleven_multilingual_v2`) to change the copy.

**Note:** the sandbox had no LiveKit, so `record.cjs` fills the stage with demo speakers and demo listener counts for the footage.
