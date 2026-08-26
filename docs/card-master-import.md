# Card Master 匯入

匯入 JSON 必須是陣列。每筆只允許 `cardId`、`cardType`、`cardName`、`rarities`；不得加入官方卡圖、卡牌效果文字、來源 metadata 或其他欄位。

```json
[
  {
    "cardId": "0001",
    "cardType": "character",
    "cardName": "江戶川柯南",
    "rarities": ["R", "SR"]
  }
]
```

`cardId` 必須是恰好四個十進位數字（保留前導零），並會成為 `cards/{cardId}` 的文件 ID。`cardType` 只能是 `character`、`event`、`case` 或 `partner`；`cardName` 與每個 `rarities` 值都必須是非空字串。

匯入器會先解析、白名單驗證並合併整份檔案，再初始化 Firebase Admin 或寫入資料。同一 `cardId` 只有在 `cardType` 與修剪後的 `cardName` 完全相同時才能重複出現；這種紀錄的稀有度會修剪、去重並排序。相同 ID 對應不同類型或名稱會拒絕整份檔案。寫入只會 upsert 以下欄位，絕不刪除 Card Master：

```json
{"cardType":"character","cardName":"江戶川柯南","rarities":["R","SR"]}
```

先以受控同步器產生候選檔，確認其乾淨報告（四種 type 的筆數與 `conflicts=0`），並取得明確的 production approval；未完成這兩個條件前不得匯入 production。

此 CLI 使用 Firebase Admin SDK 的 Application Default Credentials（ADC），不是瀏覽器 Firebase config。請以有最小必要 Firestore 寫入權限的受控 operator 身分設定 ADC，例如 `gcloud auth application-default login`，或將 `GOOGLE_APPLICATION_CREDENTIALS` 指向該身分的服務帳戶憑證；同時設定目標專案：

```sh
export GOOGLE_CLOUD_PROJECT='your-project-id'
```

目前仍未執行、且在取得乾淨候選報告與明確 production approval 前保持禁止的命令是：

```sh
GOOGLE_CLOUD_PROJECT='your-project-id' npm run import:cards -- /tmp/conan-card-master-multi-type.json
```

一次 Firestore batch 最多寫入 450 筆，並依 `cardId` 排序後依序提交。整個檔案不是跨 batch 原子交易：若第 N 個 batch 失敗，前面的 batches 可能已經提交。修正認證或網路問題後，可安全地重新執行相同的 idempotent upsert 命令；它不會刪除文件。
