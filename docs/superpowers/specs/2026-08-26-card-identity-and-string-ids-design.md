# Conan TCG 字串卡片 ID 與複合身份設計

## 目標

Card Master 不再把玩家可見的卡片 ID 當成唯一鍵。系統需支援 `0001` 與 `P001` 兩種卡面 ID，允許同一 ID 對應不同卡片名稱或類型，也允許完全相同的可見資料由不同 Listing 實拍呈現不同卡面。

本次仍只保存路基亞已授權的卡片類型、卡片名稱、ID 與稀有度。不得保存官方卡圖、牌效、特徵、來源內部編號（例如 `PR226`）或其他未授權欄位。

## 已確認的產品決策

- 不提供卡面版本篩選；買家透過賣家實拍辨識不同卡面。
- 同 `cardType + cardName + cardId` 的資料合併唯一稀有度。
- 同 `cardType + cardName + cardId + rarity`、但卡面不同的來源紀錄視為同一個可見 Card Master 組合。
- 同一 `cardId + rarity` 若名稱或類型不同，必須保留為不同的可搜尋組合。
- `cardId` 是可搜尋字串，不是 Card Master 的 Firestore document ID。
- ID 去除前後空白並轉成大寫。
- 合法完整 ID 僅有四位數字（例如 `0001`）或 `P` 加三位數字（例如 `P001`）。
- 路基亞來源中的 `B0982` 是已確認的單筆誤植，卡面實際為 `0982`；同步器只透過受控修正表改正這一筆，不建立通用的去字母規則。

## 來源稽核

2026-08-26 對 `https://rugiacreation.com/conan/search` 的 PR、B01–B11、D01–D11 共 23 個公開版本頁進行唯讀稽核：

- 解析出 2,256 筆卡面出現紀錄。
- 1,955 筆符合四位數字格式，共 1,168 個唯一 ID。
- 300 筆符合 `P` 加三位數字格式，共 88 個唯一 ID。
- 唯一其他格式是 B09 角色卡「中森青子」R 的 `B0982`；實卡確認為 `0982`，列入受控修正表。

同步器完成修正與複合身份彙整後，仍需重新輸出完整筆數、共用 ID 統計、修正清單及 collision 報告，才能形成 production 候選檔案。

## ID 正規化與驗證

### 完整 ID

```ts
const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/;
```

正規化流程：

1. 確認輸入是字串。
2. `trim()`。
3. 轉成大寫。
4. 套用受控來源修正（僅同步器使用）。
5. 以 `CARD_ID_PATTERN` 驗證。

不得把 ID 轉成 number，避免遺失前導零。

### 搜尋前綴

市集搜尋接受空字串或以下前綴：

- 一到四位數字，例如 `0`、`09`、`0982`。
- `P` 後接零到三位數字，例如 `P`、`P0`、`P00`、`P001`。

輸入先正規化為大寫。長度一到三時以 `startsWith` 比對，長度四時精確比對。其他格式顯示「卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。」且不增加 Firestore request。

## Card Master 資料模型

### 應用程式模型

```ts
type CardType = 'character' | 'event' | 'case' | 'partner';

interface Card {
  key: string;
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: readonly string[];
}
```

- `key` 是內部 Card Master identity 與 Firestore document ID。
- `cardId` 是玩家可見、可搜尋的卡面 ID。
- UI、Listing、Sale 與通知永遠顯示 `cardId`，不顯示 `key`。

### Deterministic `cardKey`

先建立 canonical tuple：

```ts
[
  cardType,
  cardName.trim().normalize('NFC'),
  normalizeCardId(cardId),
]
```

以 tuple 的 JSON 字串計算完整 SHA-256 hex，document ID 為 `card_<64 hex characters>`。Importer 在任何 Firebase 初始化或寫入前完成 key 計算，若相同 key 對應不同 canonical tuple，整份輸入拒絕。

### Firestore 文件

新路徑為 `cards/{cardKey}`，文件只保存：

```ts
{
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
}
```

`cardKey` 不重複保存於 document data。Card Master 仍公開讀、禁止所有 client write。

## 舊 Card Master 相容

舊文件路徑為 `cards/{cardId}`，可能沒有 `cardId` data field。Converter 規則：

1. `key` 永遠使用 snapshot document ID。
2. 若 data 有合法 `cardId`，使用正規化後的值。
3. 若 data 沒有 `cardId`，將舊 document ID 當成可見 `cardId`。
4. 舊 `characterName` 與單值 `rarity` 仍只在讀取邊界轉成新版模型，不得寫回。

Repository 載入新舊文件後，以 canonical `cardType + cardName + cardId` 去重。完全相同時優先保留具有明確 `cardId` data field 的新版文件；合併並排序所有合法 `rarities`。

第一次 production 遷移不刪除舊文件。舊文件清理必須是日後獨立、明確批准且可稽核的工作。

## Listing、Sale 與通知

新 Listing 繼續保存不可變的可見快照：

```ts
{
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarity: string;
  characterName?: string;
}
```

Listing 不保存 `cardKey`，因為產品不區分相同可見資料的不同卡面版本；賣家照片才是實際商品依據。建立 Listing 前仍需在 Card Master 找到完整 `cardType + cardName + cardId + rarity` 組合，且必須在圖片上傳前完成驗證。

Sale 與 Email／Discord event 繼續使用 Listing 快照，因此只需將 ID 長度／格式測試更新為可接受 `P001`。角色通知仍只接受角色卡，並要求 `characterName === cardName`。

## 模糊 Legacy Listing

舊 Listing 顯示順序：

1. 優先使用 Listing 的完整 `cardType`、`cardName`、`rarity` 與 `cardId` 快照。
2. 若只有 `characterName`，依既有規則視為角色卡。
3. 若只剩 `cardId`，以 Card Master 查找候選。
4. 只有一個 canonical 候選時才補入 Card Master metadata。
5. 有兩個以上候選時顯示「卡片資料不明確」，不得任意選第一筆，也不得顯示角色訂閱控制。

Owner 編輯舊 Listing 仍只更新可變欄位，不修改或補寫不可變 metadata。

## 同步器

同步器只投影來源的卡片類型、名稱、可見 ID 與稀有度。正規化規則：

- `cardName`：trim 並 NFC normalization，保留顯示文字。
- `cardId`：trim、轉大寫，再套用受控修正表。
- `rarity`：trim、轉大寫。

受控修正表初始內容：

```ts
{ B0982: '0982' }
```

彙整 key 是 `cardType + cardName + cardId`。相同 key 合併、排序並去重 rarities；相同 `cardId` 對應不同名稱或類型是合法資料，不再使同步失敗。完全相同的 occurrence 視為來源重複卡面，只增加 duplicate occurrence 計數，不建立卡面版本。

未知卡片類型、未知 ID 格式、空名稱或空稀有度仍使整次同步失敗，且不產生部分 artifact。

同步報告必須包含：

- 四種類型的 canonical Card 筆數。
- 四位數字與 `P` 加三位數字的 ID 筆數。
- 共用同一 `cardId` 的不同 canonical Card 組數。
- 合併的重複 occurrence 數。
- 套用的受控修正來源值、修正值與次數。
- `cardKey` collision 數，production 候選必須為零。

## JSON 匯入與 production gate

JSON artifact 仍只允許：

```ts
{
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
}
```

Importer 必須先完整解析、正規化、以 composite identity 合併、驗證欄位白名單、產生 deterministic keys 並檢查 collision，之後才能初始化 Admin SDK。寫入維持有界分批、依序 fail-stop、可安全重跑的 idempotent upsert；不執行刪除。

Production 匯入需要：

1. 新版同步器產生完整 artifact。
2. 報告確認未知 ID 為零、key collision 為零，並列出受控修正。
3. Automated tests 與本機驗收通過。
4. 使用者明確批准 exact artifact 與 import command。

## 上架 UX

欄位順序維持 `卡片類型 → 卡片名稱 → 稀有度 → ID`。

- Card options 使用 `card.key` 作為 React／select 內部 identity。
- 畫面只顯示 `cardId`，不顯示 hash 或來源內部編號。
- 前三欄依目前 Card Master candidates 逐步縮小 ID。
- 完全相同的可見組合只呈現一個 ID 選項。
- ID control 必須使用可輸入英文字母的文字鍵盤，設定 `maxLength={4}`、`autoCapitalize="characters"`、`spellCheck={false}`，不得使用 numeric-only input mode。
- 送出時使用正規化後的完整 ID，並再次驗證完整可見組合。

## Marketplace 搜尋 UX

獨立 ID 搜尋欄位使用 `type="text"`、`maxLength={4}` 與可輸入 `P` 的鍵盤設定。它永遠不依賴類型、名稱或稀有度欄位，並可與其他篩選共同使用。

Listing 篩選只使用 Listing 的可見 `cardId` 快照：

- `0`、`09`、`098` 前綴匹配數字 ID。
- `P`、`P0`、`P00` 前綴匹配 `P` 開頭的卡片 ID；這不代表卡片類型一定是 Partner。
- `0982`、`P001` 精確匹配完整 ID。

Card Master、Listing 卡片、詳情、Dashboard、Sale、Email 與 Discord 均顯示可見 `cardId`。

## 錯誤處理與安全

- 同步遇到未知 ID 不嘗試猜測或自動刪字母；必須停止並要求新增受控修正或擴充已批准格式。
- `B0982 → 0982` 修正必須有單元測試與同步報告，不能隱藏。
- Importer 發現 key collision、禁用欄位或不合法資料時，在 Admin SDK 初始化前整批拒絕。
- Card Master Rules 維持公開讀、client write denied；新 document key 不授予任何額外寫入權限。
- Listing 建立仍依 authenticated owner 與既有 Rules；完整 Card Master 組合由應用程式驗證。
- 不保存官方圖片、圖片 URL、牌效、特徵或 Rugia 來源內部編號。

## 測試與驗收

### Domain、converter 與 repository

- 接受 `0001`、`0982`、`P001`，拒絕其他完整格式。
- ID normalization 保留前導零並將 `p001` 轉為 `P001`。
- `cardKey` 對相同 canonical tuple 穩定，對不同名稱或 ID 不同。
- 新 Card converter 分離 `key` 與 `cardId`；舊文件 fallback 正確。
- 新舊 Card Master 完整可見組合去重、rarities 合併。
- 同 ID 不同名稱或類型同時存在。

### 同步與匯入

- 23 個版本只產生兩種批准的 ID 格式。
- `B0982` 明確修正為 `0982`，其他未知格式失敗。
- 相同 ID、不同名稱不再誤判為衝突。
- 完全相同 occurrence 合併且計入報告。
- Importer 在初始化前完成 composite merge、key generation 與 collision check。
- 超過 500 筆的分批與 partial failure 可重跑行為維持通過。

### UI 與 Listing flow

- 上架可選 `P001` 並建立合法 Listing。
- 手機 ID 欄位可輸入 `P`。
- `P`、`P0`、`P00`、`P001` 搜尋行為正確。
- 數字 ID 前綴與精確搜尋維持正確。
- 同 ID、同稀有度、不同名稱的商品可同時搜尋與刊登。
- 完全相同可見 metadata、不同賣家照片可建立不同 Listings。
- cardId-only legacy Listing 有唯一候選時 fallback，多候選時顯示不明確。
- 角色訂閱、Sale、Email 與 Discord 顯示正規化可見 ID。

### 完成門檻

- Root tests、production build、Functions tests/build、Rules Emulator、sync/import Node tests 全部通過。
- 新同步報告列出兩種 ID 格式、受控修正、共用 ID、duplicate occurrence 與零 key collision。
- Desktop 與 375px 驗證上架及 Marketplace ID 輸入。
- Production import 未經 artifact-specific 明確批准不得執行。

## 明確不包含

- 卡面版本或 alternate-art 篩選。
- 官方卡圖、牌效、特徵或來源內部 ID。
- 自動或本次執行中的舊 Card Master 文件刪除。
- 未經批准的 production import、deploy 或 push。
