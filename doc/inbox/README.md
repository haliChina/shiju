# inbox 草稿区

未核查 / 核查中的候选句子放这里，命名 `draft-<主题>-<YYYYMMDD>.json`。

草稿格式与成品相同（见 `../SCHEMA.md`），但 `verified` 必须为 `false`，
`verifyNote` 写明待核查点或淘汰原因。

**草稿不要直接导入网页**：核查通过、跑过 `../tools/validate_quotes.py` 之后，
再移入 `../quotes/` 并改名为 `verified-*`。
