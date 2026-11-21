#!/usr/bin/env python3
"""拾句核查成品包校验器。

用法:
    python3 doc/tools/validate_quotes.py <file.json> [more.json ...]
    python3 doc/tools/validate_quotes.py --all        # 校验 doc/quotes/ 全部成品包

检查项（与网页端导入校验对齐，见 doc/SCHEMA.md）:
  - 合法 JSON、顶层为数组
  - id / content 必填且类型正确；content 1-500 字
  - id 与 content 在全部被检文件内不重复
  - tags 为字符串数组、最多 5 个、每个 <= 20 字
  - rating 为 0-5 数字、favorite 为布尔、createdAt 为正数时间戳（可选）
  - verified 为 true 时必须有 source；sourceUrl 必须是 http/https
退出码: 0 = 全部通过, 1 = 有错误。
"""
import json
import sys
from pathlib import Path

MAX_CONTENT = 500
MAX_TAGS = 5
MAX_TAG_LEN = 20


def check_file(path: Path, seen_ids: dict, seen_contents: dict, errors: list) -> int:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        errors.append(f"{path.name}: JSON 解析失败: {e}")
        return 0
    if isinstance(data, dict) and isinstance(data.get("sentences"), list):
        data = data["sentences"]
    if not isinstance(data, list):
        errors.append(f"{path.name}: 顶层必须是数组")
        return 0

    count = 0
    for i, item in enumerate(data):
        where = f"{path.name}[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: 条目必须是对象")
            continue
        count += 1
        qid = item.get("id")
        if not isinstance(qid, str) or not qid.strip():
            errors.append(f"{where}: id 缺失或不是字符串")
            qid = None
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            errors.append(f"{where}: content 缺失或不是字符串")
            content = None
        elif len(content) > MAX_CONTENT:
            errors.append(f"{where}: content 超过 {MAX_CONTENT} 字 ({len(content)})")

        if qid is not None:
            if qid in seen_ids:
                errors.append(f"{where}: id 重复 (与 {seen_ids[qid]} 相同): {qid}")
            else:
                seen_ids[qid] = where
        if content is not None:
            key = content.strip()
            if key in seen_contents:
                errors.append(f"{where}: content 与 {seen_contents[key]} 重复")
            else:
                seen_contents[key] = where

        tags = item.get("tags", [])
        if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
            errors.append(f"{where}: tags 必须是字符串数组")
        else:
            if len(tags) > MAX_TAGS:
                errors.append(f"{where}: tags 超过 {MAX_TAGS} 个")
            for t in tags:
                if len(t) > MAX_TAG_LEN:
                    errors.append(f"{where}: 标签超过 {MAX_TAG_LEN} 字: {t}")

        rating = item.get("rating", 0)
        if not isinstance(rating, (int, float)) or isinstance(rating, bool) or not (0 <= rating <= 5):
            errors.append(f"{where}: rating 必须是 0-5 的数字")
        if "favorite" in item and not isinstance(item["favorite"], bool):
            errors.append(f"{where}: favorite 必须是布尔值")
        if "createdAt" in item:
            ca = item["createdAt"]
            if not isinstance(ca, (int, float)) or isinstance(ca, bool) or ca <= 0:
                errors.append(f"{where}: createdAt 必须是正数毫秒时间戳")

        verified = item.get("verified")
        if verified is not None and not isinstance(verified, bool):
            errors.append(f"{where}: verified 必须是布尔值")
        if verified is True:
            source = item.get("source")
            if not isinstance(source, str) or not source.strip():
                errors.append(f"{where}: verified=true 时必须填写 source 出处")
        url = item.get("sourceUrl")
        if url is not None and url != "":
            if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
                errors.append(f"{where}: sourceUrl 必须是 http/https 链接")
    return count


def main(argv: list) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if "--all" in argv or not args:
        base = Path(__file__).resolve().parent.parent / "quotes"
        files = sorted(base.glob("*.json"))
        if not files:
            print("doc/quotes/ 下没有成品包")
            return 1
    else:
        files = [Path(a) for a in args]

    errors: list = []
    seen_ids: dict = {}
    seen_contents: dict = {}
    total = 0
    for f in files:
        if not f.exists():
            errors.append(f"{f}: 文件不存在")
            continue
        total += check_file(f, seen_ids, seen_contents, errors)

    for e in errors:
        print("ERROR:", e)
    if errors:
        print(f"\n校验失败: {len(errors)} 个问题, 共检查 {total} 条")
        return 1
    print(f"校验通过: {len(files)} 个文件, 共 {total} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
