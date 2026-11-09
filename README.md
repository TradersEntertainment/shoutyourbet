# 📣 ShoutYourBet

Sesli trade **kaos odaları**. Borsa bağlantısı yok, gerçek para yok — insanlar coin/endeks odalarında
sesli konuşur, LONG/SHORT bağırır, soundboard çalar, emoji yağdırır; fiyat sert oynayınca oda alarm verir.
Amaç: komedi, kaos, sohbet, eğlence.

## Neler var (Faz 1)
- **Lobi**: 10 sabit kaos odası (BTC, ETH, SOL, XRP, DOGE, Nasdaq 100, S&P 500, BIST 100, DXY, Altın) canlı fiyatla, kullanıcı odaları, oda açma (açık mikrofon / sahne modu), günlük skor tablosu.
- **Oda**: LiveKit ile sesli sohbet, konuşanın avatarı titrer, TradingView grafiği, kaos-metre.
- **🐂 LONG! / 🐻 SHORT!**: sunucu o anki fiyatı kaydeder, odada dev banner çıkar. `SHOUT_HORIZON_SEC` (varsayılan 15 dk) sonra puanlanır: "🎯 kâhin" ya da "💀 REKT".
- **Soundboard** (korna, REKT, aya!, kasa, ağla, alkış, siren, boing) — ElevenLabs ile üretilmiş kısa efektler (`apps/web/public/sfx`), yüklenemezse WebAudio yedeği.
- **Emoji yağmuru** 🚀💀🐻🐂🤡🔥😂🩸
- **Ani hareket alarmı**: 60 sn içinde enstrümana özel eşik aşılırsa (kripto ~%1, endeks ~%0.5) siren + ekran sarsıntısı + flaş.
- **Sahne modu**: host el kaldıranları sahneye alır/indirir, atar. Herkes istediğini sadece kendisi için susturabilir.
- LiveKit anahtarı yoksa da oda açılır: ses hariç her şey (efektler, bağırmalar, alarm, skor) SSE üzerinden çalışır.

## Mimari
```
apps/api      Fastify — LiveKit token, odalar, fiyatlar (SSE), alarm motoru, skorlama
apps/web      Next.js 15 — lobi + oda (LiveKit React bileşenleri)
packages/shared  enstrüman listesi, data-mesaj protokolü, soundboard listesi
db/schema.sql        PostgreSQL şeması (API açılışta kendisi uygular)
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

## Anahtarlar — nereden alınır?
Tek zorunlu anahtar **LiveKit** (sesli sohbet). Fiyatlar ve grafik anahtarsız.

| Ne için | Servis | Nasıl alınır | Ücret |
|---|---|---|---|
| Sesli sohbet (zorunlu) | **LiveKit Cloud** | cloud.livekit.io → Google/GitHub ile kayıt ol → **Create project** → sol menü **Settings → API Keys** → **Create key**. Ekranda çıkan `URL` (wss://…livekit.cloud), `API Key`, `API Secret` değerlerini `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` olarak gir. Secret bir kez gösterilir, sakla. | Ücretsiz katman başlangıç için yeterli |
| Kripto fiyatları | Binance public WebSocket | Anahtar gerekmez | Ücretsiz |
| Endeks fiyatları | Yahoo Finance chart endpoint | Anahtar gerekmez (gecikmeli) | Ücretsiz |
| Grafik | TradingView widget | Anahtar gerekmez | Ücretsiz |
| $SHOUT ekonomisi | PostgreSQL | Railway → **+ New → Database → PostgreSQL** (ya da Supabase) → `DATABASE_URL` | Hobby planında |
| $SHOUT ekonomisi | `SESSION_SECRET` | Kendin üret: `openssl rand -hex 32` | — |
| $SHOUT token | Solana devnet | `pnpm --filter @syb/api token:create` (aşağıda) | Ücretsiz (devnet) |

Anahtarlar **sadece api servisine** girilir; web'e girilmez (tarayıcıya sızmasın).

## $SHOUT token ekonomisi (Solana)
**Ücretsiz oyna, kazan, harca.** Kimse tahmine para yatırmaz; doğru tahminler hazineden $SHOUT kazandırır.

| | |
|---|---|
| Token | **$SHOUT**, Solana Token-2022, 6 ondalık, zincir üstü metadata |
| Arz | 1.000.000.000, tek seferde basılır, **basım yetkisi iptal** (yeni token basılamaz) |
| Dağılım | Ödül havuzu %50 (hazine) · Ekosistem %20 · Likidite %15 · Ekip %15 |
| Kazanma | Pozitif puan başına 1 $SHOUT, günde en fazla 500 · haftalık ilk 10'a sezon bonusu (1000 → 60) |
| Çekme | Kazanılan bakiye cüzdana çekilir (en az 100, günde en fazla 2000), ücreti hazine öder |
| Harcama | Mağaza: Megafon (50), Altın lakap (100), Neon oda teması (200), Degen ses paketi (500) — bakiyeden ya da cüzdandan zincir üstü ödeme |
| Bahşiş | Odada konuşmacıya cüzdandan cüzdana $SHOUT |

Kurallar tek dosyada: `packages/shared/src/economy.ts`.

**Nasıl çalışır**
- Giriş: cüzdan bir mesaj imzalar (işlem değil, ücret yok) → API imzayı doğrular, tek kullanımlık nonce, 7 günlük oturum.
- Kazançlar zincir dışı bir **defterde** (`ledger`, append-only, idempotent) tutulur; kullanıcı istediğinde hazineden cüzdanına gönderilir. Çekimde cüzdan başına kilit var (paralel istekle çift harcama yok); transfer başarısız olursa bakiye otomatik iade edilir.
- Cüzdandan ödemeler zincirde doğrulanır: imzalayan, mint, alıcı (hazine) ve tutar birebir kontrol edilir; aynı işlem ikinci kez kullanılamaz.

**Token'ı oluştur (devnet)**
```bash
pnpm --filter @syb/api token:create
```
İlk çalıştırmada hazine cüzdanı üretilir. Devnet'in RPC faucet'i kapalı olduğu için komut adresi yazıp durur: o adrese https://faucet.solana.com üzerinden (devnet) 1 SOL gönder ve komutu tekrar çalıştır. Çıktıdaki `SHOUT_MINT` ve `SOLANA_TREASURY_SECRET` değerlerini api'nin ortam değişkenlerine koy. Anahtarlar `.secrets/devnet/` altında kalır (git'e girmez), public adresler `scripts/token/devnet.json`'a yazılır. Token logosu/metadata'sı: `apps/web/public/token/` (URI'yi `TOKEN_METADATA_URI` ile kendi domainine çevir; güncelleme yetkisi hazinede).

**Lokal test (faucet gerektirmez)**
```bash
solana-test-validator --reset                       # Agave/Solana CLI
SOLANA_CLUSTER=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @syb/api token:create
# api: DATABASE_URL, SESSION_SECRET, DEV_TOOLS=1, SOLANA_CLUSTER=localnet, SOLANA_RPC_URL, SHOUT_MINT, SOLANA_TREASURY_SECRET
API_URL=http://localhost:4000 SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @syb/api exec tsx scripts/e2e-economy.ts   # 24 kontrol
node apps/web/e2e/wallet.e2e.cjs ./out                                                                                      # tarayıcı: bağlan, imzala, çek, satın al, megafon
```

> **Hukuki not.** Kullanıcının token yatırıp tahmine girdiği (kazanırsa kaybedenin parasını aldığı) bir model kumar/ikili opsiyon sayılır ve bilerek kurulmadı. Mainnet'e çıkmadan, token'ı satmadan veya bir borsada likidite açmadan önce hukuk görüşü al (Türkiye'de 7518 sayılı kanun / SPK, AB'de MiCA). Çok hesapla ödül toplama (sybil) riski için günlük tavanlar var; mainnet öncesi cüzdan yaşı/SOL bakiyesi şartı veya captcha eklenmeli.

## Railway'e deploy
Ses **LiveKit Cloud**'da kalır (Railway WebRTC/UDP medya sunucusu için uygun değil). Railway'de iki servis açılır: `api` ve `web`.

1. Railway → **New Project → Deploy from GitHub repo** → bu repo. İki servis oluştur (aynı repo, ikisinde de **Root Directory boş** kalsın, pnpm workspace kökten çözülür).
2. Her serviste **Settings → Config-as-code → Railway config file**:
   - api servisi: `apps/api/railway.json`
   - web servisi: `apps/web/railway.json`
3. **api servisi → Settings → Region: EU West (Amsterdam) veya Southeast Asia (Singapore).** Binance ABD IP'lerini engeller (HTTP 451); ABD bölgesinde kripto fiyatı gelmez.
4. Her iki servise **Networking → Generate Domain**.
5. Değişkenler:

| Servis | Değişken | Değer |
|---|---|---|
| api | `LIVEKIT_URL` | `wss://<proje>.livekit.cloud` |
| api | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit Cloud → Settings → Keys |
| api | `PRICE_MODE` | `live` |
| api | `SHOUT_HORIZON_SEC` | `900` |
| web | `NEXT_PUBLIC_API_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` (servis adın `api` değilse onu yaz) |

`PORT`'u Railway kendisi verir, ekleme. `DEV_TOOLS` ekleme (prod'da `/debug` kapalı kalsın).

**Notlar**
- `NEXT_PUBLIC_API_URL` build sırasında gömülür: API domaini değişirse web'i yeniden deploy et.
- `DATABASE_URL` verildiğinde tahminler, skorlar ve $SHOUT bakiyeleri Postgres'te kalıcıdır. Kullanıcı odaları hâlâ bellekte: api'yi **tek replika** çalıştır.
- Railway'de api servisine Postgres'i bağla: değişken `DATABASE_URL=${{Postgres.DATABASE_URL}}`, ayrıca `SESSION_SECRET`, `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SHOUT_MINT`, `SOLANA_TREASURY_SECRET`.
- Yahoo Finance bulut IP'lerini ara ara sınırlayabilir (429) → endeks fiyatı geç gelebilir; kalıcı çözüm Finnhub/Twelve Data provider'ı.
- Maliyet: iki küçük servis Railway Hobby planına sığar; LiveKit Cloud ücretsiz katmanı ayrıca.

## Yol haritası
- **Faz 2**: Expo mobil uygulama (`@livekit/react-native`, dev build gerekir), moderasyon paneli, sybil koruması, $SHOUT mainnet lansman hazırlığı (hukuk görüşü sonrası).
- **Faz 3**: talep gelen coin/endeksler, oda içi anketler, "günün balinası" rozetleri, klip paylaşımı.

> Yatırım tavsiyesi değildir. Puanlar sanaldır; uygulama para/ödül içermez.
