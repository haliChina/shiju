# 导入 JSON 规范

拾句网页「设置 → 数据管理 → 导入」接受一个 JSON 数组（或带 `sentences` 字段的对象）。
本规范与网页端导入校验（`script.js` 的 `sanitizeImportedItem`）保持一致。

## 字段表

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 全局唯一。核查成品包用 `vq-<四位序号>`；重复 id 导入时会被改号收录 |
| `content` | string | 是 | 句子原文，1–500 字，必须与出处原文一致 |
| `author` | string | 建议 | 作者姓名，如 `李白`；无作者的古籍可写篇名来源，如 `《论语》` 的条目 author 写 `孔子` 并在 source 注明 |
| `tags` | string[] | 否 | 最多 5 个，每个 ≤ 20 字；优先用站内预设：励志、哲思、人生、情感、自然、学习、文学、诗词、经典、生活、成长、梦想 |
| `rating` | number | 否 | 0–5，默认 0 |
| `favorite` | boolean | 否 | 默认 false |
| `createdAt` | number | 否 | 毫秒时间戳；缺省由导入端按当前时间补齐，成品包请写固定值保证可复现 |
| `source` | string | 核查包必填 | 出处，写到篇目一级：`李白《将进酒》`、`《论语·学而》` |
| `sourceUrl` | string | 否 | 原文页面链接（http/https）；**只填实际打开核对过的**，没核对过就省略 |
| `verified` | boolean | 核查包必填 | 是否已按 `AGENT_GUIDE.md` 完成核查 |
| `verifiedAt` | string | 否 | 核查日期 `YYYY-MM-DD` |
| `verifyNote` | string | 否 | 核查依据、异文说明、归属争议说明 |

> 网页端展示：`verified === true` 且有 `source` 时，卡片显示「已核查」徽章，
> 详情页显示「已核查出处：<source>」与原文链接。用户在网页里编辑句子不会丢失这些字段。

## 最小示例

```json
[
  {
    "id": "vq-0001",
    "content": "学而时习之，不亦说乎？",
    "author": "孔子",
    "tags": ["学习", "经典"],
    "rating": 0,
    "favorite": false,
    "createdAt": 1735689600000,
    "source": "《论语·学而》",
    "verified": true,
    "verifiedAt": "2026-11-21",
    "verifyNote": "核对《论语·学而》篇首句原文。"
  }
]
```

## 注意事项

- 文件必须是合法 JSON，UTF-8 编码，顶层为数组。
- 同一文件内 `id` 与 `content` 都不能重复；与已有成品包也不能撞 id / 撞内容。
- 导入是「合并」语义：同 id 会改号收录而不是覆盖，想更新已发布条目请改内容后换新 id 并在 PR/提交说明里注明。
