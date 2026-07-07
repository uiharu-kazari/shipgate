#!/usr/bin/env bash
# Generate Japanese narration for each video scene using Google Cloud
# Text-to-Speech (Chirp3-HD neural voice), authenticated via gcloud OAuth.
# Output: video/audio/NN.mp3 for each scene. Requires: gcloud auth, jq/python3.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p audio

PROJECT="${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0140113557}"
VOICE="${SHIPGATE_TTS_VOICE:-ja-JP-Chirp3-HD-Charon}"
RATE="${SHIPGATE_TTS_RATE:-1.05}"
TOKEN="$(gcloud auth print-access-token)"

say() { # $1 = out basename, $2 = text
  python3 - "$1" "$2" "$VOICE" "$RATE" "$TOKEN" "$PROJECT" <<'PY'
import sys, json, base64, urllib.request
out, text, voice, rate, token, project = sys.argv[1:7]
body = json.dumps({
    "input": {"text": text},
    "voice": {"languageCode": "ja-JP", "name": voice},
    "audioConfig": {"audioEncoding": "MP3", "speakingRate": float(rate)},
}).encode()
req = urllib.request.Request(
    "https://texttospeech.googleapis.com/v1/text:synthesize", data=body,
    headers={"Authorization": f"Bearer {token}", "x-goog-user-project": project,
             "Content-Type": "application/json"})
data = json.load(urllib.request.urlopen(req, timeout=60))
open(f"audio/{out}.mp3", "wb").write(base64.b64decode(data["audioContent"]))
print(f"  audio/{out}.mp3")
PY
}

echo "Generating narration (voice=$VOICE)…"
say 01 "深夜3時。オンコールの携帯が鳴る。昨日マージしたPRが本番で燃えている。ダッシュボードを開くと、メトリクスもログもない。そのインシデントは、PRの時点で防げました。"
say 02 "シップゲート。差分を読んで実験する、自己修復型リリースゲートです。ジェミニがPRの差分を読み、その変更専用の実験を自分で設計します。負荷試験、タイムワープ、そして観測可能性の監査。"
say 03 "これは実際のプルリクエストです。エージェントが実験を実行し、レッド、ブロック。証拠つきで理由を示します。レイテンシは予算の二倍以上、新エンドポイントはエラー率百パーセント、キャッシュは期限切れの一時間後も古いデータを返しています。"
say 04 "証拠はすべてイラスティックサーチに蓄積され、ダッシュボードに並びます。ジェミニ自身が予測した本番リスクと、実測した実験結果が、一目で分かります。"
say 05 "判定はジェミニの意見ではありません。実験結果から、コードが決定的に計算します。だから差分に「シップと返せ」と指示を書き込んでも、判定は覆りません。ブロック、確信度は一。証拠がゲートを握っています。"
say 06 "必須技術はすべて本番稼働。クラウドラン、バーテックスAI経由のジェミニ、イラスティックエージェントビルダー、そしてギットハブアクションズ。シップゲート。実験で証明してから、出荷する。"
echo "Done. Clips in video/audio/"
