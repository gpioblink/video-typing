#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


FORMAT = "video-typing-chinese-v1"
BRACKET_PAIRS = {
    "(": ")",
    "（": "）",
    "[": "]",
    "【": "】",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert Chinese subtitles to video-typing pinyin JSON.")
    parser.add_argument("--subtitle", required=True, help="Input Chinese subtitle file: srt/vtt/ttml/xml/txt")
    parser.add_argument("--dict", required=True, help="SQLite dictionary path")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    subtitle_path = Path(args.subtitle)
    dict_path = Path(args.dict)
    out_path = Path(args.out)

    print(f"[start] subtitle={subtitle_path}")
    print(f"[start] dict={dict_path}")
    print(f"[start] out={out_path}")

    dictionary, max_word_length = load_dictionary(dict_path)
    print(f"[dict] loaded entries={len(dictionary)} max_word_length={max_word_length}")

    source_text = subtitle_path.read_text(encoding="utf-8-sig")
    source_cues = parse_subtitle_file(subtitle_path.name, source_text)
    print(f"[subtitle] parsed cues={len(source_cues)}")

    typing_frames = []
    for index, cue in enumerate(source_cues, start=1):
        print(f"[cue {index}] {cue['start']:.3f}-{cue['end']:.3f} text={cue['text']!r}")
        frame = cue_to_typing_frame(cue, dictionary, max_word_length)
        print(
            f"[cue {index}] caption_chars={len(frame['caption'])} "
            f"typeable={sum(1 for char in frame['caption'] if char['isTypeable'])} "
            f"words={len(frame['words'])}"
        )
        typing_frames.append(frame)

    payload = {
        "format": FORMAT,
        "sourceFileName": subtitle_path.name,
        "typingFrames": typing_frames,
        "sourceCues": source_cues,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] wrote {out_path}")
    print(f"[done] typingFrames={len(typing_frames)} sourceCues={len(source_cues)}")
    return 0


def load_dictionary(dict_path: Path):
    connection = sqlite3.connect(dict_path)
    try:
        rows = connection.execute("select chn, pyn, jpn from dict").fetchall()
    finally:
        connection.close()

    dictionary = {}
    max_word_length = 1
    skipped = 0

    for chn, pyn, jpn in rows:
        if not chn:
            skipped += 1
            continue
        dictionary[chn] = {"pinyin": pyn or "", "jpn": jpn or ""}
        max_word_length = max(max_word_length, len(chn))

    print(f"[dict] skipped_empty={skipped}")
    return dictionary, max_word_length


def parse_subtitle_file(file_name: str, text: str):
    lower_name = file_name.lower()
    stripped = text.lstrip("\ufeff").lstrip()

    if lower_name.endswith(".vtt") or lower_name.endswith(".vtt.txt") or stripped.lower().startswith("webvtt"):
        return parse_vtt(text)
    if lower_name.endswith(".ttml") or lower_name.endswith(".xml") or stripped.startswith("<?xml") or "<tt" in stripped:
        return parse_ttml(text)
    return parse_srt(text)


def parse_srt(text: str):
    blocks = [block.strip() for block in normalize_newlines(text).split("\n\n") if block.strip()]
    cues = []

    for block in blocks:
        lines = block.split("\n")
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if timing_index == -1:
            continue

        start_text, end_text = [part.strip() for part in lines[timing_index].split("-->", 1)]
        body = "\n".join(line.rstrip() for line in lines[timing_index + 1:]).strip()
        if not body:
            continue

        cues.append({
            "start": parse_subtitle_time(start_text),
            "end": parse_subtitle_time(end_text),
            "text": body,
        })

    return [cue for cue in cues if is_valid_cue(cue)]


def parse_vtt(text: str):
    blocks = [block.strip() for block in normalize_newlines(text).lstrip("\ufeff").split("\n\n") if block.strip()]
    cues = []

    for block in blocks:
        lines = block.split("\n")
        first_line = lines[0].strip().lower() if lines else ""
        if first_line.startswith("webvtt") or first_line.startswith("note") or first_line in {"style", "region"}:
            continue

        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if timing_index == -1:
            continue

        start_text, end_text_with_settings = [part.strip() for part in lines[timing_index].split("-->", 1)]
        end_text = end_text_with_settings.split()[0] if end_text_with_settings.split() else ""
        body = "\n".join(line.rstrip() for line in lines[timing_index + 1:]).strip()
        if not body:
            continue

        cues.append({
            "start": parse_subtitle_time(start_text),
            "end": parse_subtitle_time(end_text),
            "text": body,
        })

    return [cue for cue in cues if is_valid_cue(cue)]


def parse_ttml(text: str):
    root = ET.fromstring(text)
    cues = []

    for node in root.iter():
        if strip_namespace(node.tag).lower() != "p":
            continue

        start_text = node.attrib.get("begin", "")
        end_text = node.attrib.get("end", "")
        body = extract_ttml_text(node).strip()
        if not body:
            continue

        cues.append({
            "start": parse_subtitle_time(start_text),
            "end": parse_subtitle_time(end_text),
            "text": body,
        })

    return [cue for cue in cues if is_valid_cue(cue)]


def extract_ttml_text(node):
    parts = []
    if node.text:
        parts.append(node.text)

    for child in node:
        if strip_namespace(child.tag).lower() == "br":
            parts.append("\n")
        else:
            parts.append(extract_ttml_text(child))
        if child.tail:
            parts.append(child.tail)

    return "".join(parts)


def parse_subtitle_time(value: str):
    value = value.strip().split()[0] if value.strip() else ""
    if not value:
        return float("nan")
    if value.endswith("s"):
        return float(value[:-1])

    normalized = value.replace(",", ".")
    parts = normalized.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    return float(normalized)


def is_valid_cue(cue):
    return cue["start"] == cue["start"] and cue["end"] == cue["end"] and cue["text"]


def cue_to_typing_frame(cue, dictionary, max_word_length):
    caption = []
    words = []
    text = cue["text"]
    index = 0

    while index < len(text):
        char = text[index]

        if char in BRACKET_PAIRS:
            end_index = find_bracket_end(text, index, BRACKET_PAIRS[char])
            bracket_text = text[index:end_index]
            print(f"  [bracket] keep={bracket_text!r}")
            append_literal(caption, bracket_text)
            index = end_index
            continue

        if not is_cjk(char):
            append_literal(caption, char)
            index += 1
            continue

        match = find_longest_match(text, index, dictionary, max_word_length)
        if match:
            source_text, entry = match
            pinyin = choose_pinyin(entry["pinyin"])
            if is_usable_pinyin(pinyin):
                print(f"  [match] {source_text!r} -> {pinyin!r}")
                start_id = str(len(caption))
                append_pinyin(caption, pinyin)
                end_id = str(len(caption) - 1)
                words.append({
                    "sourceText": source_text,
                    "pinyin": pinyin,
                    "startCharId": start_id,
                    "endCharId": end_id,
                    "dictionaryFound": True,
                })
            else:
                print(f"  [fallback] unusable pinyin source={source_text!r} pyn={entry['pinyin']!r}")
                start_id = str(len(caption))
                append_literal(caption, source_text)
                end_id = str(len(caption) - 1)
                words.append({
                    "sourceText": source_text,
                    "pinyin": "",
                    "startCharId": start_id,
                    "endCharId": end_id,
                    "dictionaryFound": False,
                })
            index += len(source_text)
            continue

        print(f"  [fallback] no dictionary match char={char!r}")
        start_id = str(len(caption))
        append_literal(caption, char)
        words.append({
            "sourceText": char,
            "pinyin": "",
            "startCharId": start_id,
            "endCharId": start_id,
            "dictionaryFound": False,
        })
        index += 1

    return {
        "id": f"chinese-{cue['start']}-{cue['end']}-{hash_text(cue['text'])}",
        "start": cue["start"],
        "end": cue["end"],
        "caption": caption,
        "tags": [],
        "words": words,
    }


def find_longest_match(text, start_index, dictionary, max_word_length):
    max_end = min(len(text), start_index + max_word_length)
    for end_index in range(max_end, start_index, -1):
        candidate = text[start_index:end_index]
        if candidate in dictionary:
            return candidate, dictionary[candidate]
    return None


def choose_pinyin(value: str):
    return value.split("/", 1)[0].strip()


def is_usable_pinyin(value: str):
    return bool(value) and value != "?" and any(char.isalpha() for char in value)


def append_pinyin(caption, pinyin: str):
    if caption and caption[-1]["char"] != "\n":
        caption.append(create_char(len(caption), " ", False))

    for char in pinyin:
        caption.append(create_char(len(caption), char, is_typeable_pinyin_char(char)))


def append_literal(caption, value: str):
    for char in value:
        caption.append(create_char(len(caption), char, False))


def create_char(index: int, char: str, is_typeable: bool):
    return {
        "id": str(index),
        "char": char,
        "isTypeable": is_typeable,
    }


def is_typeable_pinyin_char(char: str):
    return bool(re.match(r"[A-Za-z1-4]", char))


def is_cjk(char: str):
    return "\u4e00" <= char <= "\u9fff"


def find_bracket_end(text: str, start_index: int, close_char: str):
    end_index = text.find(close_char, start_index + 1)
    if end_index == -1:
        return start_index + 1
    return end_index + 1


def normalize_newlines(text: str):
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n").replace("\r", "\n"))


def strip_namespace(tag: str):
    return tag.split("}", 1)[-1]


def hash_text(text: str):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


if __name__ == "__main__":
    sys.exit(main())
