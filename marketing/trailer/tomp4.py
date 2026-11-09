import json, os, subprocess, sys
T = os.path.dirname(os.path.abspath(__file__))
for name in sorted(os.listdir(f"{T}/raw")):
    d = f"{T}/raw/{name}"
    m = json.load(open(f"{d}/meta.json"))
    fr = m["frames"]
    with open(f"{d}/list.txt", "w") as f:
        for i, ts in enumerate(fr):
            dur = (fr[i + 1] - ts) if i + 1 < len(fr) else 0.5
            f.write(f"file 'frames/{i:05d}.jpg'\nduration {max(dur, 0.001):.4f}\n")
        f.write(f"file 'frames/{len(fr)-1:05d}.jpg'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{d}/list.txt",
                    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "medium",
                    f"{d}/raw.mp4"], check=True)
    # marks relative to first frame
    rel = {k: round(v - fr[0], 3) for k, v in m["marks"].items()}
    json.dump(rel, open(f"{d}/marks.json", "w"))
    print(name, rel)
