# Card Master 匯入

匯入 JSON 必須是陣列。每筆只允許 `cardId`、`cardType`、`cardName`、`rarities`；不得加入 `officialImage`、圖片 URL、`effect`／牌效、特徵、來源 metadata，或路基亞內部編號如 `PR226`。

```json
[
  {"cardId":"0501","cardType":"character","cardName":"諸伏高明","rarities":["D"]},
  {"cardId":"0501","cardType":"event","cardName":"事件 0501","rarities":["D"]},
  {"cardId":"P001","cardType":"partner","cardName":"江戶川柯南","rarities":["P"]}
]
```

`cardId` 是玩家可見的字串，必須是四位數字（保留前導零）或 `P` 加三位數字。匯入邊界會 trim 並轉為大寫。`cardType` 只能是 `character`、`event`、`case` 或 `partner`；`cardName` 與每個 `rarities` 值都必須是非空字串。

Card Master identity 是 `cardType + NFC-trimmed cardName + normalized cardId`，rarity 不參與 identity。匯入器以 canonical tuple JSON 的完整 SHA-256 hex 建立 deterministic key，寫入 `cards/{card_<full-sha256>}`。文件 data 仍保留可見 `cardId`，且只寫入：

```json
{"cardId":"P001","cardType":"partner","cardName":"江戶川柯南","rarities":["P"]}
```

匯入器會先完整解析、欄位白名單驗證、正規化、複合 identity 合併、key generation 與 collision 檢查，全部通過後才初始化 Firebase Admin。同一 identity 會合併、去重並排序 rarities；同一可見 `cardId` 對應不同類型或名稱是合法的不同 Card Master 記錄。相同 key 若對應不同 canonical tuple，整份輸入會在 Admin 初始化前拒絕。

## 候選檔與報告門檻

只能用受控同步器產生候選檔。來源 ID 的唯一受控修正是 `B0982 -> 0982`；不得建立通用的去字母規則。同步必須在沒有 invalid-ID error 或 artifact refusal 的情況下完整成功，才會產生候選檔；其報告還必須確認 `keyCollisions=0`，並明列 `B0982->0982` 的修正次數後才可進入人工審核。

匯入前先執行 dry run；它會重新驗證完整 artifact，並透過 Firebase Admin **唯讀**查詢
`cardMasterArchives`。合法的 `disabled`、`superseded`、`merged` 封存 key 都會抑制同一
identity，避免後續路基亞同步重新建立已停用或已合併的卡片。報告會顯示 `records`、
`batches`、`keyCollisions=0`、`suppressedCount`，以及有命中時依序列出的
`suppressedKeys`。Dry run 不會建立 write batch，也不會寫入或刪除任何文件：

```sh
node scripts/import-card-master.mjs --dry-run /tmp/conan-card-master-composite.json
```

## Production 認證與禁止指令

實際 CLI 使用 Firebase Admin SDK 的 Application Default Credentials（ADC），不是瀏覽器 Firebase config。只能以有最小必要 Firestore 寫入權限的受控 operator 身分設定 ADC，並明確設定目標專案。

由於 dry run 需要讀取正式環境的封存集合，它也需要 ADC 與明確的目標專案；其身分只需
`cardMasterArchives` 讀取權。Archive 查詢失敗、重複 key、欄位不完整、disposition
不合法或 identity/key 不一致時，整次操作會在任何 Card 寫入前中止。

```sh
export GOOGLE_CLOUD_PROJECT='your-project-id'
```

**禁止執行 production 匯入：**除非使用者已明確批准這一份 exact generated artifact 與下列 exact command，否則不得執行：

```sh
GOOGLE_CLOUD_PROJECT='your-project-id' npm run import:cards -- /tmp/conan-card-master-composite.json
```

## 分批、重試與 legacy 文件

每個 Firestore batch 最多 450 筆，並依已驗證的 deterministic plan 依序提交。整份檔案不是跨 batch 原子交易：若第 N 個 batch 失敗，前面的 batches 可能已提交。修正認證或網路問題後，可安全重跑同一 artifact；deterministic keys 與 idempotent upsert 會使已完成的寫入安全重複。

匯入器仍是 upsert-only。Artifact 中被 archive 抑制的 Card 不會進入 batch；資料庫中由
admin 新增、但不存在於路基亞 artifact 的 active Card 也不會被刪除。匯入器不會修改或
刪除 `cardMasterArchives` 與 `cardMasterAuditLogs`。

這次遷移只 upsert 新的 composite-key 文件，不會呼叫 delete API，也不會刪除現有 `cards/{cardId}` legacy 文件。legacy 清理必須是日後獨立、明確批准且可稽核的工作。
