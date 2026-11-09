"""Assemble EN + TR trailers: scene cuts timed to VO, music ducked under VO, SFX on action marks."""
import json, os, subprocess, sys

T = os.path.dirname(os.path.abspath(__file__))
SFX_DIR = os.path.join(T, "..", "..", "apps", "web", "public", "sfx")
FPS = 30


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).strip())


def marks(name):
    return json.load(open(f"{T}/raw/{name}/marks.json"))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(cmd)[:2000])
        print(r.stderr[-3000:])
        sys.exit(1)


def build(lang):
    vo = {f"s{i}": f"{T}/audio/vo_{lang}_s{i}.mp3" for i in range(1, 9)}
    L = {k: dur(v) for k, v in vo.items()}
    m1, m2, ml = marks("room1"), marks("room2"), marks("lobby")
    q = lambda x: round(x * FPS) / FPS  # frame-align

    # (key, raw source, src_start, duration, vo_offset)
    scenes = []
    d1 = max(L["s1"] + 1.0, 3.6)
    scenes.append(("s1", f"card_intro_{lang}", 0.0, d1, 0.55))
    d2 = max(L["s2"] + 0.5, 4.0)
    scenes.append(("s2", "lobby", max(0.3, ml["click"] + 0.08 - d2), d2, 0.15))  # cut on the click
    s3_start = max(0.0, m1["long"] - L["s3"] + 0.15)
    scenes.append(("s3", "room1", s3_start, max(L["s3"] + 0.4, m1["long"] + 1.1 - s3_start), 0.1))
    s4_start = m2["short"] - 0.45
    d4 = max(L["s4"] + 0.7, 1.9)
    scenes.append(("s4", "room2", s4_start, d4, 0.15))
    s5_start = max(s4_start + d4, m2["alarm"] - 1.3)
    scenes.append(("s5", "room2", s5_start, max(L["s5"] + 0.6, 4.2), 0.1))
    s6_start = m2["horn"] - 0.25
    scenes.append(("s6", "room2", s6_start, max(L["s6"] + 1.2, 4.0), 0.75))
    s7_start = m2["results"] - 0.1
    scenes.append(("s7", "room2", s7_start, max(L["s7"] + 0.9, 5.4), 0.2))
    scenes.append(("s8", f"card_outro_{lang}", 0.0, max(L["s8"] + 2.2, 5.2), 0.45))

    out_dir = f"{T}/out/{lang}"
    os.makedirs(out_dir, exist_ok=True)

    # ---- video: cut scenes, concat
    timeline, t = [], 0.0
    concat = []
    for i, (key, src, ss, d, vo_off) in enumerate(scenes):
        d = q(d)
        clip = f"{out_dir}/scene{i+1}.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ss:.3f}", "-i", f"{T}/raw/{src}/raw.mp4", "-t", f"{d:.3f}",
             "-vf", f"fps={FPS},scale=1920:1080,format=yuv420p", "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", clip])
        concat.append(f"file '{clip}'")
        timeline.append(dict(key=key, src=src, ss=ss, d=d, t=t, vo_off=vo_off))
        t += d
    total = t
    with open(f"{out_dir}/concat.txt", "w") as f:
        f.write("\n".join(concat) + "\n")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{out_dir}/concat.txt",
         "-vf", f"fade=in:st=0:d=0.4,fade=out:st={total-0.6:.3f}:d=0.6", "-c:v", "libx264", "-crf", "17", "-preset", "medium",
         "-pix_fmt", "yuv420p", f"{out_dir}/video.mp4"])

    # ---- SFX events mapped from raw marks to timeline
    def at(src, mark_t):
        for sc in timeline:
            if sc["src"] == src and sc["ss"] <= mark_t < sc["ss"] + sc["d"]:
                return sc["t"] + (mark_t - sc["ss"])
        return None

    events = []  # (time, file, volume)
    for k, f, v in [("long", "long", 0.55), ("long2", "long", 0.4), ("long3", "long", 0.4)]:
        events.append((at("room1", m1[k]), f, v))
    for k, f, v in [("short", "short", 0.55), ("short2", "short", 0.4), ("alarm", "siren", 0.35),
                    ("horn", "horn", 0.32), ("rocket", "moon", 0.25), ("skull", "rekt", 0.4), ("cry", "cry", 0.45)]:
        events.append((at("room2", m2[k]), f, v))
    toasts = sorted((v, k) for k, v in m2.items() if k.startswith("toast"))
    for j, (tt, k) in enumerate(toasts):
        events.append((at("room2", tt + j * 0.18), "cash" if k.endswith("win") else "rekt", 0.32))
    s8 = next(s for s in timeline if s["key"] == "s8")
    events.append((s8["t"] + 0.15, "horn", 0.45))
    events = [(e, f, v) for e, f, v in events if e is not None]

    # ---- audio mix
    inputs = ["-i", f"{T}/audio/music.mp3"]
    parts, labels = [], []
    # VO bus
    for i, sc in enumerate(timeline):
        inputs += ["-i", vo[sc["key"]]]
        ms = int((sc["t"] + sc["vo_off"]) * 1000)
        parts.append(f"[{i+1}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=1.15[v{i}]")
        labels.append(f"[v{i}]")
    nvo = len(timeline)
    parts.append(f"{''.join(labels)}amix=inputs={nvo}:normalize=0,acompressor=threshold=0.15:ratio=3:attack=5:release=120,apad=whole_dur={total:.3f}[vo]")
    parts.append("[vo]asplit=2[vomix][vokey]")
    # music, ducked by VO
    parts.append(f"[0:a]aresample=44100,atrim=0:{total:.3f},asetpts=PTS-STARTPTS,volume=0.6,afade=t=in:st=0:d=0.3,afade=t=out:st={total-2.2:.3f}:d=2.2[mus]")
    parts.append("[mus][vokey]sidechaincompress=threshold=0.03:ratio=7:attack=20:release=350:makeup=1[musd]")
    # SFX bus
    sl = []
    for j, (e, f, v) in enumerate(events):
        inputs += ["-i", f"{SFX_DIR}/{f}.mp3"]
        ms = int(e * 1000)
        parts.append(f"[{nvo+1+j}:a]aresample=44100,aformat=channel_layouts=stereo,volume={v},adelay={ms}|{ms}[x{j}]")
        sl.append(f"[x{j}]")
    parts.append(f"{''.join(sl)}amix=inputs={len(sl)}:normalize=0[sfx]")
    parts.append(f"[musd][vomix][sfx]amix=inputs=3:normalize=0,atrim=0:{total:.3f},loudnorm=I=-14:TP=-1.0:LRA=9[aout]")
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(parts), "-map", "[aout]", "-ar", "48000", "-c:a", "pcm_s16le", f"{out_dir}/audio.wav"])

    final = f"{T}/out/shoutyourbet-trailer-{lang}.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", f"{out_dir}/video.mp4", "-i", f"{out_dir}/audio.wav", "-map", "0:v", "-map", "1:a",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", final])
    print(f"{lang}: {total:.1f}s -> {final}")
    for sc in timeline:
        print(f"  {sc['key']} {sc['src']:<14} src@{sc['ss']:5.2f} dur {sc['d']:4.2f}  at {sc['t']:5.2f}  VO {L[sc['key']]:.2f}s")
    print("  sfx:", ", ".join(f"{f}@{e:.1f}" for e, f, _ in sorted(events)))


for lang in sys.argv[1:] or ["en", "tr"]:
    build(lang)
