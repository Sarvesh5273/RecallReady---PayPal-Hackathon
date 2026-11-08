"""Synchronize supplied narration with genuine footage and bottom subtitles.

The silent picture lock is preserved. This creates a separate audio edition.
No source approval, payment, or product UI is synthesized or reenacted.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "recordings/submission"
FINAL = OUT / "final"
FINAL.mkdir(exist_ok=True)
for folder in ("parts", "captions"):
    (FINAL / folder).mkdir(exist_ok=True)
audio = OUT / "audio/narration-original.wav"
transcript = json.loads((OUT / "audio/transcript.json").read_text())
original = json.loads((OUT / "capture-manifest.json").read_text())
shots = {s["id"]: s for s in original["shots"]}
lock = json.loads((ROOT / "docs/video/PICTURE_LOCK.json").read_text())
silent = OUT / lock["videoFile"]
if hashlib.sha256(silent.read_bytes()).hexdigest() != lock["sha256"]:
    raise SystemExit("The original picture lock changed.")


def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def timecode(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def video_part(source, a, b, duration, name, crop=None):
    filters = [f"trim=start={a}:end={b}", "setpts=PTS-STARTPTS"]
    if crop:
        x, y, w, h = crop
        filters.extend([f"crop={w}:{h}:{x}:{y}",
                        "scale=1920:972:force_original_aspect_ratio=decrease",
                        "pad=1920:1080:(ow-iw)/2:(972-ih)/2:color=0xf5f7f0"])
    filters.extend(["setsar=1", "fps=30", f"tpad=stop_mode=clone:stop_duration={duration}",
                    f"trim=duration={duration}", "format=yuv420p"])
    file = FINAL / "parts" / (name + ".mp4")
    run(["-i", str(source), "-vf", ",".join(filters), "-an", "-c:v", "libx264",
         "-preset", "fast", "-crf", "18", str(file)])
    return file


def join_video(parts, name):
    listfile = FINAL / (name + "-concat.txt")
    listfile.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
    file = FINAL / (name + ".mp4")
    run(["-f", "concat", "-safe", "0", "-i", str(listfile), "-c", "copy", str(file)])
    return file


# Keep real action sequences. Rebalance holds to fit the supplied eight scenes.
# The result remains exactly 170 seconds without changing the voice speed.
source_parts = [
    video_part(shots["03"]["rawVideo"], .8, 5.3, 7, "source-overview", [0, 0, 1920, 1080]),
    video_part(shots["03"]["rawVideo"], 5.5, 10.5, 10, "source-conflict", [1080, 800, 770, 280]),
    video_part(shots["03"]["rawVideo"], 40, 42, 2, "source-review", [300, 590, 760, 490]),
    video_part(shots["03"]["rawVideo"], 101, 105.8, 5, "source-approved", [0, 0, 1920, 1080]),
]
source_video = join_video(source_parts, "03-synced")
case_parts = [
    video_part(OUT / "04-screen.mp4", 0, 5.4, 5.4, "case-exact"),
    video_part(OUT / "04-screen.mp4", 8, 11.96, 3.96, "case-different"),
    video_part(OUT / "04-screen.mp4", 16.5, 25, 15.64, "case-missing"),
]
case_video = join_video(case_parts, "04-synced")
tech_video = video_part(OUT / "07-screen.mp4", 0, 16, 17, "implementation")
closing_video = video_part(OUT / "08-screen.mp4", 0, 15, 17, "closing")
picture = join_video([OUT / "01-screen.mp4", OUT / "02-screen.mp4", source_video,
                      case_video, OUT / "05-screen.mp4", OUT / "06-screen.mp4",
                      tech_video, closing_video], "picture-synced")

# Absolute source-audio cuts, scene starts, leading silence, and optional pauses
# anchored at actual spoken sentence boundaries from local Whisper timings.
scenes = [
    dict(id=1, source=(0, 14.47), start=0, duration=18, lead=.25, pauses=[]),
    dict(id=2, source=(14.47, 27.5), start=18, duration=14, lead=.2, pauses=[]),
    dict(id=3, source=(27.5, 49.68), start=32, duration=24, lead=.5, pauses=[]),
    dict(id=4, source=(49.68, 69.82), start=56, duration=25, lead=.25,
         pauses=[(54.08, .75), (57.04, 1)]),
    dict(id=5, source=(69.82, 99.64), start=81, duration=34, lead=1.3, pauses=[]),
    dict(id=6, source=(99.64, 117.34), start=115, duration=21, lead=.25, pauses=[(101.04, 2.7)]),
    dict(id=7, source=(117.34, 133.87), start=136, duration=17, lead=.1, pauses=[]),
    dict(id=8, source=(133.87, 150.596), start=153, duration=17, lead=.1, pauses=[]),
]
audio_inputs = []
mapping = []
for scene in scenes:
    a, b = scene["source"]
    segments = []
    cursor = a
    local_time = scene["lead"]
    if local_time:
        segments.append(("silence", local_time))
    for split, pause in [*scene["pauses"], (b, 0)]:
        segments.append(("audio", cursor, split))
        mapping.append(dict(scene=scene["id"], sourceStart=cursor, sourceEnd=split,
                            outputStart=scene["start"] + local_time))
        local_time += split - cursor
        if pause:
            segments.append(("silence", pause))
            local_time += pause
        cursor = split
    tail = scene["duration"] - local_time
    if tail < -.001:
        raise SystemExit(f"Narration exceeds scene {scene['id']}.")
    if tail > 0:
        segments.append(("silence", tail))
    filters = []
    for i, seg in enumerate(segments):
        if seg[0] == "silence":
            filters.append(f"anullsrc=r=16000:cl=mono,atrim=duration={seg[1]},asetpts=PTS-STARTPTS[a{i}]")
        else:
            _, sa, sb = seg
            length = sb - sa
            filters.append(f"[0:a]atrim=start={sa}:end={sb},asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st={max(0,length-.005)}:d=0.005[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(len(segments))) +
                   f"concat=n={len(segments)}:v=0:a=1,atrim=duration={scene['duration']}[voice]")
    output = FINAL / "parts" / f"voice-{scene['id']:02}.wav"
    run(["-i", str(audio), "-filter_complex", ";".join(filters), "-map", "[voice]", str(output)])
    audio_inputs.append(output)
audio_list = FINAL / "audio-concat.txt"
audio_list.write_text("".join(f"file '{p.as_posix()}'\n" for p in audio_inputs))
timed_audio = FINAL / "narration-synced.wav"
run(["-f", "concat", "-safe", "0", "-i", str(audio_list), "-af",
     "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", str(timed_audio)])

# Correct transcription formatting and the PB003 recognition error against the
# supplied script, official source conflict, and targeted recognition check.
words = []
for entry in transcript["transcription"]:
    text = entry["text"].strip()
    if not text:
        continue
    start = entry["offsets"]["from"] / 1000
    end = entry["offsets"]["to"] / 1000
    part = next((p for p in mapping if p["sourceStart"] <= start < p["sourceEnd"]), None)
    if not part:
        raise SystemExit("Unmapped transcript word: " + text)
    text = text.replace("PD003", "PB003")
    words.append(dict(text=text, startMs=round((part["outputStart"] + start - part["sourceStart"]) * 1000),
                      endMs=round((part["outputStart"] + min(end, part["sourceEnd"]) - part["sourceStart"]) * 1000),
                      timestampMs=None, confidence=None, scene=part["scene"]))
merged = []
i = 0
while i < len(words):
    word = words[i].copy()
    if word["text"].lower() == "recall" and i + 1 < len(words) and words[i+1]["text"].lower().startswith("ready"):
        word["text"] = "RecallReady" + words[i+1]["text"][5:]
        word["endMs"] = words[i+1]["endMs"]
        i += 1
    merged.append(word)
    i += 1
words = merged
(FINAL / "captions-words.json").write_text(json.dumps(words, indent=2) + "\n")

font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 40)
small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
measure = ImageDraw.Draw(Image.new("RGB", (1920, 94)))
captions, group = [], []
for word in words:
    if group and (word["scene"] != group[-1]["scene"] or
                  word["startMs"] - group[-1]["endMs"] > 300 or len(group) >= 9 or
                  measure.textlength(" ".join(w["text"] for w in [*group, word]), font=font) > 1500):
        captions.append(group)
        group = []
    group.append(word)
    if re.search(r"[.!?]$", word["text"]):
        captions.append(group)
        group = []
if group:
    captions.append(group)
cue_list = []
for i, group in enumerate(captions):
    start = group[0]["startMs"] / 1000
    end = group[-1]["endMs"] / 1000
    next_start = captions[i+1][0]["startMs"] / 1000 if i+1 < len(captions) else 170
    end = min(next_start, max(start + .2, end + .12))
    cue_list.append(dict(text=" ".join(w["text"] for w in group), start=start, end=end, scene=group[0]["scene"]))
(FINAL / "captions.json").write_text(json.dumps(cue_list, indent=2) + "\n")
(FINAL / "RecallReady-subtitles.srt").write_text("\n\n".join(
    f"{i+1}\n{timecode(c['start'])} --> {timecode(c['end'])}\n{c['text']}" for i,c in enumerate(cue_list)) + "\n")


def footer(text, name):
    im = Image.new("RGB", (1920, 94), "#123d34")
    draw = ImageDraw.Draw(im)
    draw.text((960, 7), text, font=font, fill="white", anchor="mt")
    draw.text((960, 68), "SYNTHETIC ORDERS  ·  PAYPAL SANDBOX  ·  REVIEW/PROCESSING WAITS SHORTENED",
              font=small, fill="#d6e4d8", anchor="mt")
    file = FINAL / "captions" / name
    im.save(file)
    return file


blank = footer("", "blank.png")
footer_ranges = []
cursor = 0
for i, cue in enumerate(cue_list):
    if cue["start"] > cursor:
        footer_ranges.append((blank, cue["start"] - cursor))
    image = footer(cue["text"], f"caption-{i:03}.png")
    footer_ranges.append((image, cue["end"] - cue["start"]))
    cursor = cue["end"]
if cursor < 170:
    footer_ranges.append((blank, 170-cursor))
listfile = FINAL / "caption-images.txt"
listfile.write_text("".join(f"file '{p.as_posix()}'\nduration {duration:.6f}\n" for p,duration in footer_ranges) +
                    f"file '{blank.as_posix()}'\n")
footer_video = FINAL / "subtitle-strip.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(listfile), "-vf", "fps=30", "-t", "170",
     "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", str(footer_video)])
final_video = FINAL / "RecallReady-submission-demo-captioned.mp4"
run(["-i", str(picture), "-i", str(footer_video), "-i", str(timed_audio),
     "-filter_complex", "[0:v][1:v]overlay=0:986:shortest=1[v]", "-map", "[v]", "-map", "2:a",
     "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
     "-t", "170", "-movflags", "+faststart", str(final_video)])
manifest = dict(videoFile=final_video.name, suppliedAudio="narration-original.mp3", durationSeconds=170,
                silentPictureLockPreserved=True, narrationRegenerated=False, voiceSpeed=1,
                captionsPosition="bottom strip, y=986..1080", decorativeThirdPartyLogosAdded=False,
                sourceVisible="Saved CPSC source snapshot plus exact PB0003/PB003 evidence conflict",
                scenes=scenes, audioMapping=mapping, captionCount=len(cue_list),
                captionCorrections=["Recall Ready → RecallReady", "PD003 → PB003 (script, source, targeted recognition)"],
                pictureChanges="Rebalanced scene holds and case cuts for actual narration; retained all original approvals.")
(FINAL / "final-edit-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(dict(videoReady=str(final_video), captions=len(cue_list), durationSeconds=170)), flush=True)
