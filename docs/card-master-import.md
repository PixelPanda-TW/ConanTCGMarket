# Card Master 匯入

匯入 JSON 必須是陣列；每筆只允許 `cardId`、`nameZh`、`nameJa`、`rarity`。`rarity` 不可為空，且中文或日文名稱至少要有一個；`cardId` 不可重複。

```json
[{"cardId":"CP-001","nameZh":"諸伏景光","nameJa":"諸伏景光","rarity":"CP"}]
```

不得匯入或保存官方卡圖、卡牌效果文字，或任何其他欄位。驗證會在批次寫入前完成，驗證或連線失敗時不會刪除既有 Card Master。
