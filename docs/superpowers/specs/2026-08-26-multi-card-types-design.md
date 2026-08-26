# Conan TCG 多卡片類型與獨立 ID 搜尋設計

## 目標

在現有角色卡市集加入事件卡、Case 卡（情境卡）與 Partner 卡（拍檔卡），同時保留可手打且可選的卡片名稱，並在公開市集加入不依賴其他欄位的卡片 ID 搜尋。

本次只保存路基亞已授權的卡片類型、卡片名稱、四位數 ID 與稀有度。不得保存或匯入官方卡圖、牌效文字或其他未授權欄位。

## 範圍

### 包含

- 四種卡片類型：角色卡、事件卡、Case 卡（情境卡）、Partner 卡（拍檔卡）。
- Card Master 與 Listing 快照的通用卡片名稱與類型。
- 舊角色卡 Card Master 文件與舊 Listing 的相容讀取。
- 市集的類型、卡名、稀有度篩選及獨立 ID 搜尋。
- 上架頁的四欄完全組合驗證。
- 路基亞 23 個版本的受控同步與 JSON 匯入。
- 角色通知僅處理角色卡。

### 不包含

- 事件卡、Case 卡或 Partner 卡的訂閱通知。
- 官方卡圖、牌效、特徵、版本代碼或其他未授權資料。
- 模糊全文搜尋服務、外部搜尋索引或 Firestore 分頁。
- 本次實作期間自動寫入 production Card Master；production 匯入需另行取得明確同意。

## 來源稽核結果

2026-08-26 對 `https://rugiacreation.com/conan/search` 的 23 個版本進行唯讀稽核：

- 解析出 1,953 筆版本內出現紀錄。
- 共 1,167 個唯一四位數 ID。
- 角色卡 957 張、情境卡 132 張、事件卡 77 張、拍檔卡 1 張。
- 沒有發現同一四位數 ID 對應不同卡片類型或名稱。

因此 Card Master 可繼續以四位數 ID 作為 Firestore 文件 ID。同步與匯入仍必須保留衝突檢查，以防來源未來改變。

## 資料模型

### Card Master

```ts
type CardType = 'character' | 'event' | 'case' | 'partner';

interface Card {
  id: string;
  cardType: CardType;
  cardName: string;
  rarities: readonly string[];
}
```

Firestore 路徑維持 `cards/{cardId}`。新文件只寫入：

```ts
{
  cardType: CardType;
  cardName: string;
  rarities: string[];
}
```

讀取舊文件時，若只有 `characterName`，converter 將其轉為：

```ts
{
  cardType: 'character';
  cardName: characterName;
}
```

既有 `rarity` 單值相容邏輯維持只讀，轉為單元素 `rarities`。

### Listing 快照

新 Listing 保存：

```ts
{
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarity: string;
  characterName?: string;
}
```

`characterName` 只在 `cardType === 'character'` 時保存，值必須等於 `cardName`，供現有角色訂閱與每日摘要使用。非角色卡不得保存偽造的角色名稱。

舊 Listing 若沒有 `cardType` 與 `cardName`，但有 `characterName`，讀取時視為角色卡。新 Listing 建立後，`cardId`、`cardType`、`cardName`、`rarity` 與 `characterName` 都不可由編輯頁修改。

## Card Master 同步與匯入

同步器查詢既有 23 個版本，將來源類型映射如下：

| 來源標籤 | `CardType` | UI 標籤 |
| --- | --- | --- |
| 角色卡 | `character` | 角色卡 |
| 事件卡 | `event` | 事件卡 |
| 情境卡 | `case` | Case 卡（情境卡） |
| 拍檔卡 | `partner` | Partner 卡（拍檔卡） |

每筆同步輸出只包含 `cardId`、`cardType`、`cardName` 與 `rarities`。未知來源類型、缺少名稱、非四位數 ID 或空稀有度均使整次同步失敗。

同一 ID、類型與名稱在不同版本出現時合併所有唯一稀有度。同一 ID 若對應不同類型或不同名稱，整次同步失敗並列出衝突 ID。

JSON 匯入器採白名單驗證，只接受上述四欄。完整檔案解析與驗證成功後才批次 upsert；解析、驗證或連線失敗時不刪除或覆寫既有 Card Master。匯入不執行全量刪除。

## UI 與互動

### 市集首頁

主要 metadata 篩選為：

1. 卡片類型：預設「全部類型」。
2. 卡片名稱：文字輸入框搭配瀏覽器 datalist；建議值依目前類型及已輸入前綴縮小。
3. 稀有度：依目前類型與完整有效卡名縮小；未選完整卡名時可顯示該類型所有稀有度。

另提供「搜尋卡片 ID」文字框：

- 使用文字型輸入以保留前導零，並使用 numeric input mode。
- 不要求先選類型、卡名或稀有度。
- 一到三位數做 ID 前綴匹配；四位數做精確匹配。
- 非數字或超過四位數不執行匹配，並顯示簡短欄位錯誤。
- 可與類型、名稱、稀有度、包手及賣貨便條件共同使用。

商品卡、商品詳情與 Dashboard 顯示 UI 類型標籤、卡片名稱、稀有度與四位 ID。角色訂閱控制只在 `cardType === 'character'` 且名稱存在於 Card Master 時顯示。

### 上架頁

上架 metadata 欄位依序為：

1. 卡片類型（必填）。
2. 卡片名稱（必填、可手打、提供 datalist）。
3. 稀有度（必填）。
4. 卡片 ID（必填）。

選擇類型後縮小卡名建議；完整有效卡名後縮小稀有度；類型、名稱與稀有度共同縮小 ID。任何上游欄位變動都清除不再有效的下游值。

送出時必須在 Card Master 找到 `cardId + cardType + cardName + rarity` 完全一致的記錄。找不到時在 metadata 區域顯示高對比錯誤，且不得上傳圖片或建立 Listing。

## 搜尋與顯示相容

本地 Marketplace 篩選使用 Listing 快照，不為每次篩選額外查詢 Firestore。公開頁仍一次載入 active Listings 與 Card Master，再於前端複合篩選。

舊資料顯示順序：

1. 使用 Listing 的 `cardType` 與 `cardName`。
2. 若缺少，使用 Listing `characterName` 並視為角色卡。
3. 若 Listing 仍缺資料，使用 Card Master 相容 converter 的結果。
4. 最後顯示明確的「未提供卡片名稱」或「未提供卡片類型」，不拋出 render 錯誤。

## 角色通知

只有 `cardType === 'character'` 的新 Listing 可以建立角色通知事件，且 `characterName` 必須存在並等於 `cardName`。

事件卡、Case 卡與 Partner 卡不顯示角色訂閱按鈕，也不進入角色每日 Email 摘要。本次不為其他卡片類型建立新的通知模式。

## 錯誤處理

- Card Master 載入失敗：市集顯示既有 error state；上架頁禁止提交並顯示載入錯誤。
- 同步來源無法存取或 HTML 結構無法解析：同步失敗且不產生可匯入的部分檔案。
- 匯入欄位超出白名單或資料衝突：整份檔案拒絕，不寫入 Firestore。
- 舊 Listing 缺少新欄位：使用相容 fallback，不阻擋公開顯示或賣家管理。
- ID 搜尋格式錯誤：只顯示輸入錯誤，不發出額外網路請求。

## Security Rules

Card Master 維持公開讀、禁止 client write。Listing 建立與 owner 更新規則維持既有限制；Card Master 組合有效性由應用程式與受控匯入保證，不開放 client 修改 cards。

若安全規則日後加入 Listing 欄位白名單，必須允許 `cardType`、`cardName`，並強制非角色卡沒有 `characterName`、角色卡的 `characterName === cardName`。本次需以 Emulator 測試確認既有 owner 與公開讀取規則沒有因新欄位退化。

## 測試與驗收

### Unit / component tests

- `Card` 與 Listing 接受四種類型，拒絕未知類型及無效快照。
- converter 將舊 `characterName` 文件轉為角色卡。
- metadata helper 依類型、卡名與稀有度產生正確選項。
- 卡名 input 可手打並提供 datalist。
- ID 搜尋獨立運作、保留前導零、支援前綴與四位精確匹配。
- ID 與其他 Marketplace 條件正確複合。
- 上架只接受 Card Master 中完全一致的四欄組合。
- 非角色卡不顯示角色訂閱控制，也不建立角色通知事件。
- 舊 Listing 在市集、詳情與 Dashboard 正確 fallback。

### Synchronizer / importer tests

- 四個來源類型映射正確。
- 同卡跨版本稀有度合併且去重。
- 同 ID 不同名稱或類型時整次拒絕。
- 未知類型、缺欄位與白名單外欄位拒絕。
- 失敗不刪除或部分覆寫既有 Card Master。

### 完成門檻

- 完整 `npm test`、production build、同步器測試與 Firebase Emulator rules tests 通過。
- 使用受控同步輸出確認四類卡片數量非零，且沒有 ID 衝突。
- 手機與桌面驗證首頁篩選、上架欄位、datalist、錯誤狀態與卡片顯示。
- production 匯入前再次輸出資料筆數與衝突報告，並取得明確部署同意。
