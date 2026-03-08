import os
import json
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── ffmpeg path ──────────────────────────────────────────────────────────────
# Windows (local): bundled ffmpeg.exe next to server.py
# Linux  (cloud) : static-ffmpeg pip package adds ffmpeg to PATH automatically
_here = Path(__file__).parent
_win_ffmpeg = _here / "ffmpeg.exe"

if _win_ffmpeg.exists():
    FFMPEG_PATH = str(_win_ffmpeg)
else:
    # On Render/Linux: use static-ffmpeg to get the binary path
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()   # adds ffmpeg to PATH
        FFMPEG_PATH = "ffmpeg"
    except ImportError:
        FFMPEG_PATH = "ffmpeg"      # fallback: rely on system PATH

PYTHON = sys.executable

# ── Frontend static files ────────────────────────────────────────────────────
FRONTEND_DIR = str(_here.parent / "frontend")


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path and (Path(FRONTEND_DIR) / path).exists():
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")


# ── Helpers ──────────────────────────────────────────────────────────────────
def run_ytdlp(args):
    cmd = [PYTHON, "-m", "yt_dlp"] + args
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


# ── API: Video Info ──────────────────────────────────────────────────────────
@app.route("/api/info", methods=["GET"])
def get_info():
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL gerekli"}), 400

    try:
        result = run_ytdlp(["--dump-json", "--no-playlist", "--quiet", url])
        if result.returncode != 0:
            return jsonify({"error": f"Video bilgisi alınamadı: {result.stderr.strip()}"}), 400

        data = json.loads(result.stdout)
        raw_formats = data.get("formats", [])

        formats = []
        seen = set()

        for f in reversed(raw_formats):
            if f.get("vcodec", "none") == "none" or not f.get("height"):
                continue
            label = f"{f['height']}p"
            if label in seen:
                continue
            seen.add(label)
            formats.append({
                "format_id": f.get("format_id", ""),
                "label": f"🎬 {label} MP4",
                "ext": "mp4",
                "height": f["height"],
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "type": "video"
            })

        formats.sort(key=lambda x: x["height"], reverse=True)

        for f in reversed(raw_formats):
            if f.get("acodec", "none") != "none" and f.get("vcodec", "none") == "none":
                formats.append({
                    "format_id": f.get("format_id", "bestaudio"),
                    "label": "🎵 Yalnızca Ses (MP3)",
                    "ext": "mp3",
                    "height": 0,
                    "filesize": f.get("filesize") or f.get("filesize_approx"),
                    "type": "audio"
                })
                break

        if not formats:
            formats = [
                {"format_id": "best[ext=mp4]", "label": "🎬 En İyi MP4", "ext": "mp4", "height": 720, "type": "video", "filesize": None},
                {"format_id": "bestaudio",     "label": "🎵 Yalnızca Ses (MP3)", "ext": "mp3", "height": 0, "type": "audio", "filesize": None},
            ]

        return jsonify({
            "title":      data.get("title", "Bilinmeyen Video"),
            "thumbnail":  data.get("thumbnail", ""),
            "channel":    data.get("uploader", ""),
            "duration":   data.get("duration_string", ""),
            "view_count": data.get("view_count", 0),
            "url":        url,
            "formats":    formats,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── API: Download ────────────────────────────────────────────────────────────
@app.route("/api/download", methods=["GET"])
def download_video():
    url    = request.args.get("url", "").strip()
    fmt    = request.args.get("format_id", "best").strip()
    ext    = request.args.get("ext", "mp4").strip()
    title  = request.args.get("title", "video").strip()

    if not url:
        return jsonify({"error": "URL gerekli"}), 400

    safe_title = "".join(c for c in title if c.isalnum() or c in " -_()").strip()[:80] or "video"
    filename   = f"{safe_title}.{ext}"

    try:
        tmp_dir      = tempfile.mkdtemp()
        out_template = os.path.join(tmp_dir, "output.%(ext)s")

        if ext == "mp3":
            cmd = [
                PYTHON, "-m", "yt_dlp",
                "--format", "bestaudio/best",
                "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0",
                "--no-playlist",
                "--ffmpeg-location", FFMPEG_PATH,
                "-o", out_template, url,
            ]
        else:
            cmd = [
                PYTHON, "-m", "yt_dlp",
                "--format", f"{fmt}+bestaudio/{fmt}/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "--no-playlist",
                "--ffmpeg-location", FFMPEG_PATH,
                "-o", out_template, url,
            ]

        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            return jsonify({"error": f"İndirme hatası: {err[-500:]}"}), 500

        out_file = next((os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir)), None)
        if not out_file or not os.path.exists(out_file):
            return jsonify({"error": "Dosya oluşturulamadı"}), 500

        content_type = "audio/mpeg" if ext == "mp3" else "video/mp4"

        def cleanup():
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)

        response = send_file(out_file, mimetype=content_type, as_attachment=True, download_name=filename)
        threading.Timer(30, cleanup).start()
        return response

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Health ───────────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    import shutil
    ffmpeg_ok = bool(shutil.which("ffmpeg")) or Path(FFMPEG_PATH).exists()
    return jsonify({"status": "ok", "ffmpeg": ffmpeg_ok})


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🎬 YT Downloader  →  http://localhost:{port}  |  ffmpeg: {FFMPEG_PATH}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
