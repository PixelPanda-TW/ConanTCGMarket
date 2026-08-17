# Conan TCG Marketplace — MVP Design Spec

## 1. 專案目標

建立一個以 **名偵探柯南 TCG 卡牌二手交易資訊**為核心的網站。

網站本身不處理金流、物流或站內聊天。

主要目的：

- 讓賣家刊登自己實際持有的柯南 TCG 卡牌
- 讓買家快速搜尋正在販售的卡牌
- 比較不同賣家的價格
- 篩選交易條件
- 透過賣家提供的外部聯絡方式自行完成交易
- 讓賣家管理庫存與成交紀錄
- 讓賣家查看自己的累計售出金額

網站前端部署於：

`https://<github-username>.github.io/<project-name>/`

GitHub Repository 為主要程式碼來源。

---

# 2. MVP 核心原則

## 2.1 網站定位

本網站為：

> **柯南 TCG 卡牌刊登與搜尋平台**

不是：

- 電商平台
- 金流平台
- 物流平台
- 聊天平台
- 官方卡牌資料庫

買賣雙方實際交易由雙方自行聯絡完成。

---

## 2.2 買家不需要帳號

任何訪客都可以：

- 瀏覽商品
- 搜尋卡牌
- 查看商品照片
- 查看價格
- 查看剩餘數量
- 查看賣家資訊
- 查看聯絡方式
- 使用篩選與排序

不需要登入 Google 帳號。

---

## 2.3 賣家需要 Google 登入

只有以下操作需要登入：

- 上架商品
- 編輯自己的商品
- 管理自己的商品
- 登記成交
- 查看自己的成交紀錄
- 查看累計售出金額

MVP 使用：

**Firebase Authentication + Google Sign-In**

網站本身不建立帳號密碼系統。

---

# 3. 技術架構

## Frontend

建議：

- React
- TypeScript
- Vite

部署：

- GitHub Pages

---

## Backend Services

使用 Firebase：

### Firebase Authentication

負責：

- Google Sign-In
- 使用者 UID
- 身分驗證

### Cloud Firestore

負責：

- Card Master
- 商品
- 賣家資料
- 成交紀錄

### Firebase Storage

負責：

- 賣家上傳的實體卡牌照片

---

# 4. Card Master

網站維護一份精簡的柯南 TCG Card Master。

資料來源可以使用路基亞允許使用的文字資料。

根據目前取得的使用許可：

**可以使用：**

- 允許範圍內的文字資料
- 卡牌識別資料
- 卡牌名稱
- 稀有度

**不使用：**

- 路基亞／官方卡圖
- 卡牌效果文字

網站不應下載、儲存或重新發布上述禁止使用的資料。

---

# 5. Card Master 資料模型

```typescript
interface Card {
  id: string;

  nameZh?: string;
  nameJa?: string;

  rarity: string;
}
```

其中：

`id`

為卡牌內部唯一識別，例如來源資料中的 Card ID。

用途：

- 商品與 Card Master 關聯
- 區分同名卡牌
- 區分不同卡牌版本

不要求賣家手動輸入。

一般買家也不需要特別看到此 ID。

---

## 5.1 中文 / 日文名稱

Card Master 必須同時支援：

```text
nameZh
nameJa
```

因為資料中可能存在：

- 只有中文名稱
- 只有日文名稱
- 同時有中文與日文名稱

規則：

> `nameZh` 與 `nameJa` 至少其中一個必須存在。

不建立 aliases / 玩家俗稱系統。

避免不同譯名、簡稱造成使用者混淆。

---

# 6. 卡牌選擇

賣家不能自由輸入最終卡名。

使用：

**Autocomplete Card Selector**

例如輸入：

`諸伏`

系統搜尋：

```text
nameZh
nameJa
```

並顯示符合結果。

結果應包含：

```text
卡名 + rarity
```

例如：

```text
諸伏景光 — C
諸伏景光 — CP
諸伏景光 — SR
```

如果中文與日文名稱同時存在，可以顯示：

```text
諸伏景光 / <Japanese Name> — CP
```

賣家選擇後，商品實際儲存：

```text
cardId
```

而不是單純儲存賣家輸入的文字。

---

# 7. 商品模型

一筆 Listing 代表：

> **同一卡牌、相同版本、卡況相近的一批卡牌。**

資料模型概念：

```typescript
interface Listing {
  id: string;

  sellerId: string;
  cardId: string;

  imageUrls: string[];

  listingPrice: number;

  originalQuantity: number;
  remainingQuantity: number;

  hasSleeve: boolean;
  supportsMyShip: boolean;

  note?: string;

  status: "active" | "sold_out";

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

# 8. 商品照片

每筆商品：

**最少 1 張**

**最多 3 張**

照片必須由賣家自行上傳。

第一張照片：

> 自動作為商品封面。

其餘照片可以用於：

- 卡片背面
- 卡況
- 瑕疵
- 細節

網站不使用 TOMY 或路基亞提供的卡牌圖片作為商品圖片。

---

# 9. 卡況提醒

上架頁面在照片／數量附近顯示提醒：

> **上架提醒**
>
> 同一商品中的卡片應為相同版本且卡況相近，並共用本商品的照片與售價。
>
> 若卡片版本或卡況有明顯差異，請分開建立不同商品，以免買賣雙方產生認知落差。

MVP 不建立複雜的 Card Condition 系統。

卡況相關資訊由：

- 商品照片
- 備註

處理。

---

# 10. 商品數量

商品允許一次刊登複數張。

例如：

```text
諸伏景光 CP

單張價格：NT$500
數量：5
```

資料保存：

```text
originalQuantity = 5
remainingQuantity = 5
```

商品頁顯示：

```text
NT$500 / 張

剩餘 5 張
```

---

# 11. 成交紀錄

商品成交不代表整個 Listing 立即結束。

例如：

```text
原始數量：5
標價：NT$500 / 張
```

第一次成交：

```text
成交數量：2
成交單價：NT$450
```

商品變成：

```text
剩餘：3
```

第二次成交：

```text
成交數量：1
成交單價：NT$500
```

商品變成：

```text
剩餘：2
```

---

# 12. Sale 資料模型

每一次成交建立獨立 Sale Record。

```typescript
interface Sale {
  id: string;

  listingId: string;
  sellerId: string;
  cardId: string;

  quantity: number;

  listingUnitPrice: number;
  soldUnitPrice: number;

  soldAt: Timestamp;
}
```

保存 `listingUnitPrice` 的原因：

即使賣家之後修改商品標價，歷史成交仍然知道成交當時的刊登價格。

---

# 13. 登記成交

賣家後台商品提供：

**登記成交**

按下後顯示 Modal。

輸入：

### 成交數量

預設：

`1`

限制：

```text
1 <= 成交數量 <= remainingQuantity
```

### 實際成交單價

預設：

```text
listingPrice
```

例如：

```text
標價：NT$500

實際成交：
NT$450
```

確認後：

1. 建立 Sale Record
2. `remainingQuantity -= soldQuantity`
3. 更新商品狀態

---

# 14. 商品狀態

MVP 商品狀態：

```text
active
sold_out
```

不需要另外儲存 `partially_sold`。

只要：

```text
remainingQuantity > 0
```

就是：

```text
active
```

當：

```text
remainingQuantity === 0
```

自動變成：

```text
sold_out
```

---

# 15. 售罄商品

售罄商品：

**不顯示給一般買家。**

也就是不出現在：

- 首頁商品列表
- 搜尋結果
- 價格排序
- 篩選結果

但資料不能刪除。

賣家仍然可以在自己的 Dashboard 查看。

---

# 16. 買家首頁

首頁主要用途是：

> 搜尋正在販售的卡牌。

主要區域：

### Search Bar

可以搜尋：

- 中文卡名
- 日文卡名

例如：

```text
諸伏景光
```

搜尋結果顯示所有相關的 active Listings。

---

# 17. 商品卡片

搜尋結果中的商品卡至少顯示：

```text
[商品封面照片]

諸伏景光
CP

NT$500 / 張

剩餘 3 張

賣家：ABC

✓ 包手
✓ 賣貨便
```

點擊後進入商品詳細頁。

---

# 18. 搜尋

搜尋來源：

Card Master：

```text
nameZh
nameJa
```

搜尋流程：

```text
使用者輸入文字
        ↓
搜尋符合的 Cards
        ↓
取得 cardId
        ↓
搜尋 active Listings
        ↓
顯示結果
```

例如搜尋：

```text
諸伏景光
```

應該顯示所有符合名稱的卡牌 Listing，不限制 rarity。

---

# 19. 排序

搜尋結果支援：

### 價格低 → 高

```text
listingPrice ASC
```

### 價格高 → 低

```text
listingPrice DESC
```

MVP 不需要：

- 熱門排序
- 推薦演算法
- AI 推薦

---

# 20. 篩選

MVP 支援：

### 包手

```text
hasSleeve === true
```

### 賣貨便

```text
supportsMyShip === true
```

可以同時勾選。

---

# 21. 聯絡方式

聯絡方式類型固定。

MVP 支援：

- LINE
- Discord
- Threads
- Facebook

內容由賣家自由輸入。

例如：

```text
LINE
abc123
```

或：

```text
Threads
@abc123
```

---

# 22. Seller Profile

Google 登入後，賣家建立自己的 Profile。

概念資料：

```typescript
interface SellerProfile {
  uid: string;

  displayName: string;

  contactType:
    | "line"
    | "discord"
    | "threads"
    | "facebook";

  contactValue: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

MVP 至少需要一種聯絡方式。

---

# 23. Google 個資處理

Google 登入主要用於：

- Authentication
- UID
- 帳號識別

Google 登入 Email：

**不自動公開。**

Google Email 不作為商品預設聯絡方式。

商品頁只顯示賣家主動設定的：

```text
LINE
Discord
Threads
Facebook
```

---

# 24. Seller Dashboard

登入後提供：

**我的賣場 / Seller Dashboard**

頂部顯示：

```text
販售中商品數

已售出張數

累計售出金額
```

累計售出金額計算：

```text
SUM(
  Sale.quantity * Sale.soldUnitPrice
)
```

不是：

```text
Listing.listingPrice
```

因此可以正確處理議價。

---

# 25. Dashboard 商品管理

Dashboard 分成：

### 販售中

顯示：

- 商品
- 標價
- 原始數量
- 剩餘數量
- 已售數量
- 編輯
- 登記成交

### 已售罄

顯示：

- 商品
- 原始上架數量
- 原始標價
- 成交紀錄
- 總成交金額

已售罄商品不顯示給買家。

---

# 26. 商品編輯權限

只有：

```text
listing.sellerId === currentUser.uid
```

才能：

- 修改商品
- 登記成交
- 管理商品

其他使用者不能修改別人的 Listing。

---

# 27. Firebase Security Rules 原則

Firestore 與 Storage 不能只依靠前端隱藏按鈕。

必須在 Firebase Security Rules 強制驗證。

基本原則：

### Card Master

```text
Public Read
No Public Write
```

### Active Listings

```text
Public Read
```

### Listing Write

只有：

```text
request.auth.uid === sellerId
```

可以新增／修改自己的商品。

### Sale Records

只有：

```text
request.auth.uid === sellerId
```

可以建立／讀取自己的成交紀錄。

### Images

只有登入賣家可以上傳。

圖片 Storage Path 應包含 seller UID，例如：

```text
listings/{sellerId}/{listingId}/...
```

避免使用者覆寫其他賣家的圖片。

---

# 28. 路基亞資料同步

不要讓買家每次搜尋都即時 Request 路基亞網站。

建議流程：

```text
路基亞
 ↓
同步 Script
 ↓
資料清理
 ↓
Card Master
 ↓
Firestore
 ↓
網站搜尋
```

同步 Script 只取得已被允許使用的文字欄位。

例如：

```text
cardId
nameZh
nameJa
rarity
```

明確排除：

```text
cardImage
cardEffect
```

---

# 29. 資料同步失敗

如果路基亞：

- 暫時無法連線
- 修改網站結構
- 同步 Script 發生錯誤

網站仍然使用：

> **最後一次成功同步的 Card Master**

不能因此導致商城搜尋無法使用。

同步失敗只代表：

> 暫時沒有最新卡牌資料。

不應刪除既有 Card Master。

---

# 30. MVP 頁面

第一版只需要以下主要頁面：

### `/`

Marketplace

- 搜尋
- 商品列表
- 價格排序
- 包手篩選
- 賣貨便篩選

### `/listing/:id`

商品詳細頁

- 卡名
- rarity
- 1–3 張圖片
- 單張價格
- 剩餘數量
- 賣家
- 聯絡方式
- 包手
- 賣貨便
- 備註

### `/sell`

新增商品

需要 Google 登入。

### `/dashboard`

Seller Dashboard

需要 Google 登入。

### `/listing/:id/edit`

編輯商品

需要：

```text
currentUser.uid === listing.sellerId
```

### `/profile`

賣家資料與聯絡方式設定。

---

# 31. GitHub Pages Routing

因為網站部署於：

```text
/<project-name>/
```

前端必須正確設定 Vite Base Path。

Router 也必須考慮 GitHub Pages 不提供一般 server-side route fallback 的限制。

MVP 實作時應選擇 GitHub Pages 相容的 routing 方案，例如 Hash Router，避免使用者直接開啟：

```text
/listing/123
```

時得到 GitHub Pages 404。

---

# 32. 明確不屬於 MVP 的功能

第一版不做：

- 網站內付款
- 信用卡
- 第三方金流
- 網站內物流串接
- 站內聊天室
- 買家帳號
- 購物車
- 訂單系統
- 評價系統
- 賣家評分
- 收藏
- 推播通知
- Email 通知
- AI 推薦
- 推薦演算法
- 玩家俗稱 aliases
- 完整卡牌效果資料庫
- 官方卡圖資料庫
- 自動卡況辨識
- Card Condition 分級系統

核心原則：

> **先把「找卡 → 比價 → 找到賣家 → 聯絡賣家」做好。**

---

# 33. MVP 主要使用流程

## 買家

```text
進入網站
 ↓
搜尋「諸伏景光」
 ↓
看到所有正在販售的相關卡牌
 ↓
價格排序
 ↓
篩選「包手 / 賣貨便」
 ↓
查看實卡照片
 ↓
查看價格與剩餘數量
 ↓
查看賣家聯絡方式
 ↓
到 LINE / Discord / Threads / Facebook 聯絡賣家
```

---

## 賣家

```text
Google 登入
 ↓
設定賣家名稱與聯絡方式
 ↓
新增商品
 ↓
Autocomplete 搜尋卡牌
 ↓
選擇正確的「卡名 + rarity」
 ↓
上傳 1–3 張實卡照片
 ↓
輸入單張價格
 ↓
輸入數量
 ↓
選擇包手
 ↓
選擇賣貨便
 ↓
填寫備註
 ↓
發布
```

---

## 成交

```text
買賣雙方在站外完成交易
 ↓
賣家進 Dashboard
 ↓
選擇「登記成交」
 ↓
輸入成交數量
 ↓
輸入實際成交單價
 ↓
確認
 ↓
建立 Sale Record
 ↓
扣除 remainingQuantity
```

如果：

```text
remainingQuantity > 0
```

商品繼續公開販售。

如果：

```text
remainingQuantity === 0
```

商品變成：

```text
sold_out
```

並從買家端完全隱藏。

---

# 34. MVP 成功條件

MVP 完成時，應能完整跑通以下 Scenario：

> 賣家使用 Google 登入 → 選擇「諸伏景光 CP」→ 上傳自己的卡牌照片 → 設定 NT$500 / 張、數量 5 → 發布。

另一位未登入使用者：

> 搜尋「諸伏景光」→ 找到商品 → 看到 NT$500 / 張、剩餘 5 張 → 看到照片與聯絡方式。

賣家之後：

> 登記成交 2 張，每張 NT$450。

系統更新為：

```text
剩餘：3 張
累計售出：2 張
累計成交金額：NT$900
```

商品仍然公開。

之後剩餘 3 張全部成交：

```text
remainingQuantity = 0
```

商品自動售罄並從公開 Marketplace 消失。

Seller Dashboard 仍保留完整成交紀錄與累計售出金額。

只要這條完整流程可以穩定運作，即視為 MVP 核心功能完成。