# 📣 ShoutYourBet

Sesli trade **kaos odaları**. Borsa bağlantısı yok, gerçek para yok — insanlar coin/endeks odalarında
sesli konuşur, LONG/SHORT bağırır, soundboard çalar, emoji yağdırır; fiyat sert oynayınca oda alarm verir.
Amaç: komedi, kaos, sohbet, eğlence.

## Neler var (Faz 1)
- **Lobi**: 10 sabit kaos odası (BTC, ETH, SOL, XRP, DOGE, Nasdaq 100, S&P 500, BIST 100, DXY, Altın) canlı fiyatla, kullanıcı odaları, oda açma (açık mikrofon / sahne modu), günlük skor tablosu.
- **Oda**: LiveKit ile sesli sohbet, konuşanın avatarı titrer, TradingView grafiği, kaos-metre.
- **🐂 LONG! / 🐻 SHORT!**: sunucu o anki fiyatı kaydeder, odada dev banner çıkar. `SHOUT_HORIZON_SEC` (varsayılan 15 dk) sonra puanlanır: "🎯 kâhin" ya da "💀 REKT".
- **Soundboard** (korna, REKT, aya!, kasa, ağla, alkış, siren, boing) — WebAudio ile üretiliyor, dosya/lisans yok.
- **Emoji yağmuru** 🚀💀🐻🐂🤡🔥😂🩸
- **Ani hareket alarmı**: 60 sn içinde enstrümana özel eşik aşılırsa (kripto ~%1, endeks ~%0.5) siren + ekran sarsıntısı + flaş.
- **Sahne modu**: host el kaldıranları sahneye alır/indirir, atar. Herkes istediğini sadece kendisi için susturabilir.
- LiveKit anahtarı yoksa da oda açılır: ses hariç her şey (efektler, bağırmalar, alarm, skor) SSE üzerinden çalışır.

## Mimari
```
apps/api      Fastify — LiveKit token, odalar, fiyatlar (SSE), alarm motoru, skorlama
apps/web      Next.js 15 — lobi + oda (LiveKit React bileşenleri)
packages/shared  enstrüman listesi, data-mesaj protokolü, soundboard listesi
supabase/schema.sql  kalıcı depolama şeması (Faz 2)
```
- İstemci → oda mesajları (SFX, REACT, RAISE_HAND) LiveKit data kanalı ile gider.
- Sunucu → oda mesajları (SHOUT, RESULT, ALARM) LiveKit `sendData` ile, LiveKit yoksa `/rooms/:name/events` SSE ile gider.
- Fiyat: `PRICE_MODE=live` → Binance WebSocket (kripto) + Yahoo Finance polling (endeks, gecikmeli). `PRICE_MODE=mock` → pump/dump'lı rastgele yürüyüş (offline geliştirme).
- Yeni coin/endeks eklemek = `packages/shared/src/instruments.ts` içine bir satır.

## Çalıştırma
```bash
pnpm install
cp .env.example .env   # LiveKit anahtarlarını gir (https://cloud.livekit.io, ücretsiz katman)
pnpm dev               # api :4000, web :3000
```
Geliştirme araçları (`DEV_TOOLS=1`): `GET /debug/alarm?symbol=BTC&pct=-3` odaya sahte alarm atar.

## Yol haritası
- **Faz 2**: Expo mobil uygulama (`@livekit/react-native`, dev build gerekir), Supabase'e kalıcı depolama + giriş, gerçek ses efektleri (ElevenLabs), moderasyon paneli.
- **Faz 3**: talep gelen coin/endeksler, oda içi anketler, "günün balinası" rozetleri, klip paylaşımı.

> Yatırım tavsiyesi değildir. Puanlar sanaldır; uygulama para/ödül içermez.
