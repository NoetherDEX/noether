# Git Workflow - Adim Adim Rehber

> Bu dokuman sadece git ve GitHub islemlerini anlatir. Kafan karisirsa buraya bak.

## TL;DR

```
main        = Canli urun. DOKUNMA.
develop     = Butun feature'lar burada birlesir. Dokunma, PR ile merge et.
feature/xxx = Senin calisma alanin. Buraya push'la, PR ac.
```

---

## Branch'ler Ne Ise Yarar?

### `main`
- Testnet'te calisan canli urun buradan deploy edilir.
- **Kimse direkt push yapmaz.**
- Sadece tranche bitince `develop` → `main` PR ile merge edilir.
- Yani Tranche 1 bitene kadar main'e hic dokunulmayacak.

### `develop`
- Tum feature'larin birlestigi entegrasyon branch'i.
- **Buraya da direkt push yapilmaz.**
- Feature branch'lerden PR ile merge edilir.
- Herkesin son halini gormek istedigi yer burasi.

### `feature/xxx`
- Senin kisisel calisma alanin.
- Istedigin kadar commit at, push'la.
- Hazir olunca `develop`'a PR ac.

---

## Ilk Kurulum (Bir Kere Yap)

```bash
# Repo'yu klonla
git clone https://github.com/NoetherDEX/noether.git
cd noether

# develop branch'ine gec
git checkout develop

# Kendi feature branch'ini olustur
git checkout -b feature/cross-margin
```

Eger develop branch'i henuz yoksa (ilk kullanan sensin):

```bash
git checkout main
git checkout -b develop
git push origin develop
```

---

## Gunluk Calisma (Her Gun Yap)

### 1. Guncel kodu cek

```bash
# Kendi branch'indeyken develop'daki son degisiklikleri al
git checkout feature/cross-margin
git pull origin develop
```

Bu komutu **her gun ise baslarken** calistir. Baskalarinin develop'a merge ettigi degisiklikleri alirsin. Boylece branch'in geride kalmaz.

### 2. Calis ve commit at

```bash
# Dosyalari duzenle...

# Degisiklikleri gör
git status
git diff

# Ekle ve commit at
git add contracts/market/src/lib.rs
git add contracts/noether_common/src/types.rs
git commit -m "Add CrossMarginAccount struct and storage keys"
```

**Onemli:** `git add .` yapma. Hangi dosyalari degistirdiysen onlari tek tek ekle. Yanlislikla gereksiz dosya commitlemezsin.

### 3. Push'la

```bash
git push origin feature/cross-margin
```

Bu sadece senin feature branch'ini GitHub'a gonderir. `develop` ve `main` etkilenmez. Istedigin kadar push'la, hicbir sey bozulmaz.

---

## Feature Hazir Olunca (PR Acma)

Feature'in bittiginde veya anlamli bir parca tamamlandiginda:

### 1. GitHub'da PR ac

- GitHub'a git: https://github.com/NoetherDEX/noether
- "Pull requests" → "New pull request"
- **base:** `develop` ← **compare:** `feature/cross-margin`
- Baslik ve aciklama yaz
- "Create pull request"

```
base: develop  ←  compare: feature/cross-margin
```

> **DIKKAT:** base olarak `main` degil `develop` sec!

### 2. PR Aciklamasi Nasil Yazilir

```markdown
## Ne yapildi
- CrossMarginAccount struct eklendi
- deposit_cross_margin ve withdraw_cross_margin fonksiyonlari yazildi
- Cross-margin pozisyon acma implementasyonu tamamlandi

## Test
- cargo test gecti
- Testnet'te 2 cross-margin pozisyon acildi, collateral paylasimi dogrulandi

## Etkilenen dosyalar
- contracts/noether_common/src/types.rs
- contracts/market/src/lib.rs
- contracts/market/src/storage.rs
```

### 3. Review & Merge

- En az 1 kisi review eder
- Onay gelince "Merge pull request" (Squash merge veya normal merge, farketmez)
- Merge sonrasi feature branch'in silinebilir (GitHub otomatik sorar)

### 4. Merge Sonrasi

```bash
# Lokal develop'u guncelle
git checkout develop
git pull origin develop

# Yeni feature'a basla veya mevcut branch'i guncelle
git checkout -b feature/yeni-ozellik develop
```

---

## Birden Fazla Kisi Ayni Anda Calisirsa

Ornek senaryo:
- Mert: `feature/cross-margin` uzerinde calisiyor
- Ali: `feature/advanced-orders` uzerinde calisiyor
- Ayse: `feature/fee-tiers` uzerinde calisiyor

### Hicbir sorun yok cunku:

1. Herkes kendi branch'inde calisiyor - birbirini etkilemez.
2. Mert PR'ini `develop`'a merge eder.
3. Ali ve Ayse `git pull origin develop` yaparak Mert'in kodunu alir.
4. Ali kendi PR'ini `develop`'a merge eder.
5. Ayse `git pull origin develop` yaparak hem Mert hem Ali'nin kodunu alir.
6. Ayse kendi PR'ini merge eder.
7. Sonuc: `develop`'ta herkesin kodu birlesik ve calisiyor.

```
feature/cross-margin ──PR──┐
                           ▼
feature/advanced-orders ──PR──► develop ──(tranche bitince)──PR──► main
                           ▲
feature/fee-tiers ─────PR──┘
```

### Conflict Cikarsa?

Iki kisi ayni dosyanin ayni satirini degistirmisse GitHub "conflict var" der.

```bash
# Kendi branch'indeyken
git checkout feature/fee-tiers
git pull origin develop

# Git conflict olan dosyalari gosterir:
# CONFLICT (content): Merge conflict in contracts/market/src/lib.rs

# Dosyayi ac, conflict isaretlerini bul:
<<<<<<< HEAD
    // Senin kodin
=======
    // Develop'taki kod
>>>>>>> develop

# Ikisini birlestir (hangisi dogru ise onu birak, veya ikisini de koru)
# Sonra:
git add contracts/market/src/lib.rs
git commit -m "Resolve merge conflict with develop"
git push origin feature/fee-tiers
```

---

## Tranche Bitince (Release)

Tranche 1'deki 3 feature `develop`'a merge edildi. Simdi `develop` → `main`:

1. GitHub'da PR ac: **base:** `main` ← **compare:** `develop`
2. Baslik: `Release: Tranche 1 - Cross-Margin, Advanced Orders, Fee Tiers`
3. Herkes review eder
4. Merge
5. Main artik yeni ozellikleri iceriyor, testnet'e deploy edilir

```
T1 release:  develop ──PR──► main ──► testnet deploy
T2 release:  develop ──PR──► main ──► testnet deploy
T3 release:  develop ──PR──► main ──► mainnet deploy
```

---

## Sik Yapilan Hatalar

### "Yanlis branch'e commit attim"

```bash
# Son commit'i geri al (dosyalar korunur)
git reset --soft HEAD~1

# Dogru branch'e gec
git checkout feature/dogru-branch

# Tekrar commit at
git add .
git commit -m "mesaj"
```

### "develop yerine main'e PR actim"

- PR'i kapat (merge etme!)
- Yeni PR ac, base olarak `develop` sec

### "Branch'im cok geride kaldi"

```bash
git checkout feature/cross-margin
git pull origin develop
# Conflictleri coz (varsa)
git push
```

### "Neyi nereye push'layacagimi unuttum"

```bash
# Hangi branch'tesin?
git branch

# Her zaman kendi feature branch'ine push'la:
git push origin feature/SENIN-BRANCH-ADIN
```

---

## Komut Cheat Sheet

| Ne yapmak istiyorsun | Komut |
|----------------------|-------|
| Hangi branch'teyim? | `git branch` |
| Branch degistir | `git checkout feature/xxx` |
| Yeni branch olustur | `git checkout -b feature/xxx develop` |
| Develop'u cek | `git pull origin develop` |
| Degisiklikleri gor | `git status` ve `git diff` |
| Commit at | `git add dosya.rs && git commit -m "mesaj"` |
| Push'la | `git push origin feature/xxx` |
| Son commit'i geri al | `git reset --soft HEAD~1` |
| Baskasinin branch'ini cek | `git fetch origin && git checkout feature/xxx` |

---

## Ozet Diagram

```
Sen calisirsin:
  feature/cross-margin → push → GitHub

Hazir olunca:
  GitHub'da PR ac: feature/cross-margin → develop

Review + onay:
  Merge → develop artik senin kodunu iceriyor

Tranche bitince:
  GitHub'da PR ac: develop → main

Deploy:
  main → testnet/mainnet
```

Bu kadar. Daha fazla karmasiklastirmaya gerek yok.
