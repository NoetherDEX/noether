# Noether v2 - Developer Onboarding & Git Workflow

> Bu dokumanı oku, branch stratejisini anla, sonra kodlamaya basla.

## Proje Nedir?

Noether, Stellar/Soroban uzerinde calisan on-chain perpetual futures borsasidir. Kullanicilar BTC, ETH, XLM gibi varliklarda 10x'e kadar kaldracla long/short pozisyon acabilir.

**Tech Stack:**
- Smart Contracts: Rust + Soroban SDK (`contracts/`)
- Frontend: Next.js + React + Tailwind (`web/`)
- Keeper Bot: TypeScript + Node.js (`scripts/keeper/`)
- Network: Stellar Testnet (su an) → Mainnet (Tranche 3)

## Repo Yapisi

```
noetherv2/
├── contracts/                    # Soroban smart contracts
│   ├── noether_common/           #   Shared types, errors, math
│   ├── market/                   #   Core trading engine (positions, orders, liquidation)
│   ├── vault/                    #   Liquidity pool (LP, NOE token)
│   ├── oracle_adapter/           #   Price oracle aggregation
│   └── mock_oracle/              #   Test oracle
├── scripts/keeper/               # Keeper bot (oracle updates, liquidations, orders)
├── web/                          # Next.js frontend
│   ├── app/                      #   Pages (trade, portfolio, vault, faucet)
│   ├── components/trading/       #   Trading UI (OrderPanel, PositionsList, OrderBook)
│   ├── lib/stellar/              #   Contract interaction functions
│   └── lib/store/                #   Zustand state management
├── contracts.json                # Deployed contract addresses
├── ROADMAP.md                    # Detayli roadmap ve task breakdown
└── ONBOARDING.md                 # Bu dosya
```

## Git Workflow

### Branch Stratejisi

```
main                              ← Production (calisan testnet). DOKUNMA.
 │
 └── develop                      ← Entegrasyon branch'i. Feature'lar buraya merge olur.
      │
      ├── feature/cross-margin    ← T1.1 - Cross-margin mode
      ├── feature/advanced-orders ← T1.2 - Yeni order tipleri
      └── feature/fee-tiers       ← T1.3 - Maker/taker fee sistemi
```

### Kurallar

1. **`main`'e direkt push YASAK.** Her zaman PR ile, develop uzerinden.
2. **`develop`'a direkt push YASAK.** Feature branch'ten PR ac.
3. **Her feature kendi branch'inde gelistirilir.**
4. **Tranche bitince** `develop` → `main` merge yapilir (release).

### Gunluk Calisma Akisi

```bash
# 1. Develop'u guncelle
git checkout develop
git pull origin develop

# 2. Feature branch'ine gec (veya olustur)
git checkout feature/cross-margin
# veya yeni branch:
git checkout -b feature/benim-isim develop

# 3. Calis, commit at
git add contracts/market/src/lib.rs
git commit -m "Add cross-margin deposit function"

# 4. Feature branch'ini push'la
git push origin feature/cross-margin

# 5. Hazir olunca GitHub'da PR ac: feature/cross-margin → develop
```

### Commit Mesajlari

Kisa ve net yaz. Ornekler:

```
Add MarginMode enum and CrossMarginAccount struct
Implement cross-margin liquidation logic
Add trailing stop peak price tracking
Replace flat fee with maker/taker calculation
Fix funding rate applied twice on close
Add unit tests for cross-margin multi-position
```

**Yapma:**
- `fix` (neyi fix ettigini yaz)
- `update` (neyi update ettigini yaz)
- `wip` (commit atma, hazir olunca at)

### PR Kurallari

1. **Baslik:** Kisa, anlasilir (`Add cross-margin position opening`)
2. **Aciklama:** Ne yaptigi, neden yaptigi, test edildigi
3. **Review:** En az 1 kisi review etmeli
4. **Test:** PR acmadan once testlerin gectiginden emin ol
5. **Kucuk PR'lar:** Dev PR yerine kucuk, odakli PR'lar ac

### Conflict Cozme

Feature branch'in develop'dan geride kalirsa:

```bash
# Feature branch'indeyken develop'u merge et
git checkout feature/cross-margin
git merge develop

# Conflictleri coz, commit at
git add .
git commit -m "Merge develop into feature/cross-margin"
git push
```

**Rebase YAPMA** - merge commit daha guvenli ve takip edilebilir.

## Tranche Sistemi

Roadmap 3 tranche'a bolunmus. Her tranche bagimsiz bir release:

| Tranche | Deadline | Icerik |
|---------|----------|--------|
| T1 - MVP | 28 Mart 2026 | Cross-margin, advanced orders, fee tiers |
| T2 - Testnet | 9 Mayis 2026 | REST API, WebSocket, vaults, multi-wallet |
| T3 - Mainnet | 21 Haziran 2026 | Production oracle, mainnet deploy, docs |

Detaylar icin: `ROADMAP.md`

### Tranche 1 Feature'lari ve Sorumluluklar

**T1.1 Cross-Margin Mode**
- Contract: `market/src/lib.rs`, `liquidation.rs`, `position.rs`
- Types: `noether_common/src/types.rs`
- Frontend: `OrderPanel.tsx`, `PositionsList.tsx`
- Keeper: `index.ts`, `stellar.ts`

**T1.2 Advanced Order Types**
- Contract: `market/src/lib.rs`, `storage.rs`
- Types: `noether_common/src/types.rs` (OrderType, TimeInForce)
- Frontend: `OrderPanel.tsx`, `OrdersList.tsx`, `OrderBook.tsx`
- Keeper: `index.ts` (trailing stop updates)

**T1.3 Maker/Taker Fee System**
- Contract: `market/src/lib.rs`, `trading.rs`
- Types: `noether_common/src/types.rs` (FeeTier, VolumeRecord)
- Frontend: `OrderPanel.tsx`, yeni `FeeTierInfo.tsx`

## Lokal Gelistirme

### Gereksinimler

- Rust + `soroban-cli` (contract gelistirme)
- Node.js 18+ (frontend + keeper bot)
- Stellar testnet hesabi (Friendbot ile olustur)

### Contract Build & Test

```bash
cd contracts

# Build
soroban contract build

# Test
cargo test

# Testnet'e deploy
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/market.wasm --network testnet
```

### Frontend

```bash
cd web
npm install
npm run dev
# http://localhost:3000
```

### Keeper Bot

```bash
cd scripts/keeper
npm install
npm run start
```

## Onemli Bilgiler

### Precision

Tum on-chain degerler **7 ondalik** (PRECISION = 10^7). Ornek:
- 1 USDC = `10_000_000`
- 0.50 USDC = `5_000_000`
- %0.1 fee = `10 bps` (basis points, 10000 = %100)

### Contract Adresleri

`contracts.json` dosyasinda testnet adresleri var. Mainnet adresleri Tranche 3'te eklenecek.

### Mevcut Limitler

- Max leverage: 10x
- Min collateral: 10 USDC
- Max position size: 100,000 USDC
- Trading fee: 0.1% (flat - T1.3 ile degisecek)
- Maintenance margin: 1%
- Liquidation fee: 5% (keeper'a)
- Assets: BTC, ETH, XLM

### Vault Mekanizmasi

Vault (LP havuzu) tum trade'lerin karsi tarafidir:
- Trader kazanirsa → Vault odemesini yapar
- Trader kaybederse → Vault karini alir
- LP'ler NOE token ile havuza katilir

### Keeper Bot Gorevi

5 saniyede bir calisir:
1. Oracle fiyatlarini gunceller (Binance → Mock Oracle)
2. Liquidatable pozisyonlari tarar ve kapatir
3. Tetiklenen order'lari execute eder
4. Saatlik funding rate uygular

## Sorularin Varsa

1. `ROADMAP.md` - Detayli task breakdown ve bagimliliklar
2. `contracts/noether_common/src/types.rs` - Tum veri yapilari
3. `contracts/market/src/lib.rs` - Ana trading engine
4. Slack/Discord'dan sor
