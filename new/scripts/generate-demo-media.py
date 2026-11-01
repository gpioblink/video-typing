#!/usr/bin/env python3
"""Generate the original, offline C109 practice clips.

Requires Python 3, ffmpeg (with libvpx-vp9/libopus), and espeak-ng or espeak.
Run from any directory: python3 new/scripts/generate-demo-media.py

No downloads, fonts, external artwork, or prerecorded speech are used. Each
40-second clip has four ten-second cues, with narration beginning at +0.5s.
The matching cue text lives in the application's shared clip catalogue.
"""

from array import array
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave


WIDTH, HEIGHT, FPS, DURATION = 640, 360, 12, 40
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "demo"
CLIPS = {
    "first-steps": (
        "Hello world.",
        "Listen and type.",
        "Small steps count.",
        "You did it.",
    ),
    "a-quiet-morning": (
        "The sun is warm.",
        "A bird sings.",
        "Take a deep breath.",
        "Today is a new day.",
    ),
}


def circle(frame, x, y, radius, colour):
    """Draw a solid circle by filling contiguous scanlines."""
    x, y, radius = round(x), round(y), round(radius)
    pixel = bytes(colour)
    for row in range(max(0, y - radius), min(HEIGHT, y + radius + 1)):
        half = math.isqrt(max(0, radius * radius - (row - y) ** 2))
        left, right = max(0, x - half), min(WIDTH, x + half + 1)
        offset = (row * WIDTH + left) * 3
        frame[offset:offset + (right - left) * 3] = pixel * (right - left)


def rectangle(frame, left, top, right, bottom, colour):
    left, right = max(0, round(left)), min(WIDTH, round(right))
    pixels = bytes(colour) * (right - left)
    for row in range(max(0, round(top)), min(HEIGHT, round(bottom))):
        offset = (row * WIDTH + left) * 3
        frame[offset:offset + len(pixels)] = pixels


def gradient(top, bottom):
    return b"".join(
        bytes(round(a + (b - a) * row / (HEIGHT - 1))
              for a, b in zip(top, bottom)) * WIDTH
        for row in range(HEIGHT)
    )


NIGHT = gradient((16, 28, 48), (32, 57, 72))
DAWN = gradient((249, 223, 190), (249, 190, 150))


def render_frame(clip_id, seconds):
    if clip_id == "first-steps":
        frame = bytearray(NIGHT)
        # An orbit and four stepping stones mark an unhurried journey.
        circle(frame, 320, 172, 115, (67, 105, 116))
        circle(frame, 320, 172, 113, (25, 44, 62))
        circle(frame, 320, 172, 81 + 3 * math.sin(seconds / 2), (40, 69, 83))
        circle(frame, 320, 172, 62, (234, 159, 118))
        circle(frame, 300, 151, 13, (255, 196, 148))
        angle = seconds * math.tau / 20 - math.pi / 2
        circle(frame, 320 + 114 * math.cos(angle),
               172 + 114 * math.sin(angle), 18, (133, 220, 203))
        for x, y in [(90, 92), (550, 108), (152, 236), (508, 260)]:
            circle(frame, x, y, 2, (155, 176, 174))
        for index in range(4):
            colour = (133, 220, 203) if seconds >= index * 10 else (70, 101, 111)
            circle(frame, 275 + index * 30, 326, 5, colour)
    else:
        frame = bytearray(DAWN)
        # A sun, drifting clouds, rounded hills, and a tiny abstract bird.
        circle(frame, 442, 111 + 4 * math.sin(seconds / 5), 48, (255, 239, 175))
        cloud_x = 110 + 14 * math.sin(seconds / 7)
        for x, y, r in [(cloud_x, 92, 13), (cloud_x + 19, 86, 19),
                        (cloud_x + 38, 94, 12)]:
            circle(frame, x, y, r, (255, 242, 220))
        circle(frame, 145, 416, 216, (119, 159, 145))
        circle(frame, 486, 438, 219, (82, 131, 124))
        circle(frame, 285, 560, 287, (51, 98, 101))
        bird_x = 270 + 38 * math.sin(seconds / 8)
        bird_y = 128 + 6 * math.sin(seconds / 2)
        circle(frame, bird_x, bird_y, 6, (65, 91, 99))
        circle(frame, bird_x - 6, bird_y - 3, 6, (65, 91, 99))
        circle(frame, bird_x - 6, bird_y - 6, 5, (249, 210, 177))
        for index in range(4):
            colour = (255, 222, 170) if seconds >= index * 10 else (103, 145, 141)
            circle(frame, 275 + index * 30, 326, 5, colour)
    return frame


def narration(speaker, phrases, directory):
    # eSpeak's default English voice is formant synthesis, not a human recording.
    rate, output = None, None
    for index, phrase in enumerate(phrases):
        cue_path = directory / f"cue-{index}.wav"
        subprocess.run([speaker, "-v", "en-us", "-s", "135", "-a", "130",
                        "-w", str(cue_path), phrase], check=True)
        with wave.open(str(cue_path), "rb") as cue:
            if cue.getnchannels() != 1 or cue.getsampwidth() != 2:
                raise RuntimeError("Expected mono 16-bit eSpeak output")
            if rate is None:
                rate = cue.getframerate()
                output = bytearray(DURATION * rate * 2)
            elif cue.getframerate() != rate:
                raise RuntimeError("eSpeak changed its sample rate")
            samples = array("h", cue.readframes(cue.getnframes()))
        if len(samples) >= 9 * rate:
            raise RuntimeError("Narration must fit inside its ten-second cue")
        # A short fade keeps clip boundaries and seek/replay audio click-free.
        fade = min(round(rate * 0.01), len(samples) // 2)
        for position in range(fade):
            factor = position / max(1, fade)
            samples[position] = round(samples[position] * factor)
            samples[-1 - position] = round(samples[-1 - position] * factor)
        start = round((index * 10 + 0.5) * rate) * 2
        output[start:start + len(samples) * 2] = samples.tobytes()
    destination = directory / "narration.wav"
    with wave.open(str(destination), "wb") as result:
        result.setnchannels(1)
        result.setsampwidth(2)
        result.setframerate(rate)
        result.writeframes(output)
    return destination


def main():
    ffmpeg = shutil.which("ffmpeg")
    speaker = shutil.which("espeak-ng") or shutil.which("espeak")
    if not ffmpeg or not speaker:
        raise SystemExit("Install ffmpeg and espeak-ng (or espeak) before running.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for clip_id, phrases in CLIPS.items():
        with tempfile.TemporaryDirectory(prefix="video-typing-demo-") as temp:
            audio_path = narration(speaker, phrases, Path(temp))
            destination = OUTPUT / f"{clip_id}.webm"
            command = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "rawvideo", "-pixel_format", "rgb24",
                "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS),
                "-i", "pipe:0", "-i", str(audio_path),
                "-map", "0:v", "-map", "1:a", "-t", str(DURATION),
                "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38",
                "-deadline", "good", "-cpu-used", "4", "-row-mt", "1",
                "-pix_fmt", "yuv420p", "-g", str(FPS * 2),
                "-c:a", "libopus", "-b:a", "24k", "-ac", "1",
                "-map_metadata", "-1", str(destination),
            ]
            process = subprocess.Popen(command, stdin=subprocess.PIPE)
            try:
                for number in range(FPS * DURATION):
                    process.stdin.write(render_frame(clip_id, number / FPS))
                process.stdin.close()
                if process.wait() != 0:
                    raise RuntimeError(f"ffmpeg could not encode {clip_id}")
            except BaseException:
                process.kill()
                process.wait()
                raise
            print(f"{destination.name}: {destination.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
