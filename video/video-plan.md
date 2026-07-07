# ShipGate デモ動画 — 撮影計画 & ナレーション台本

目標尺: 約80秒 / ナレーション: 日本語（Google Cloud Text-to-Speech, Chirp3-HD）/ 画面表示: 英語UIそのまま
音声生成: `video/gen-audio.sh`（Cloud TTS, gcloud OAuth）/ 収録: `video/record.py`（Playwright, webm）/ 合成: `video/build.sh`（ffmpeg）

各シーンは「録画ソース → ナレーション（`voice:` が音声化する文）→ 画面で見せるもの」。

---

## Scene 1 — フック（HTMLスライド `scenes/01-hook.html`, 12s）
- 録画: タイトルスライド。深夜3時のイメージ、鳴るスマホ、無いダッシュボード。
- voice: 深夜3時。オンコールの携帯が鳴る。昨日マージしたPRが本番で燃えている。ダッシュボードを開くと、メトリクスもログもない。そのインシデントは、PRの時点で防げました。
- 画面: 「CI tells you your code is correct. Nobody tells you it's operable.」

## Scene 2 — 提案（HTMLスライド `scenes/02-what.html`, 12s）
- 録画: プロダクト名と3つの実験を提示するスライド。
- voice: シップゲート。差分を読んで実験する、自己検証型リリースゲートです。ジェミニがPRの差分を読み、その変更専用の実験を自分で設計します。負荷試験、タイムワープ、観測可能性の監査。
- 画面: ShipGate ロゴ + 3実験（Load / Time-warp / Observability）

## Scene 3 — 判定コメント（実ページ: GitHub PR, 14s）
- 録画: https://github.com/uiharu-kazari/shipgate-demo-shop/pull/1 の🔴 blockコメントへゆっくりスクロール。
- voice: これは実際のプルリクエストです。エージェントが実験を実行し、レッド、ブロック。証拠つきで理由を提示します。p99レイテンシは予算の二倍以上、新エンドポイントはエラー率百パーセント、キャッシュは期限切れの一時間後も古いデータを返しています。
- 画面: PR comment の [fail] 行（p99, 100% errors, 3601s stale）

## Scene 4 — ダッシュボード証拠（実ページ: ダッシュボード, 12s）
- 録画: https://shipgate-agent-maqob3nldq-an.a.run.app/ をロード、リスク分析と実験結果を上から表示。
- voice: 証拠はすべてイラスティックサーチに蓄積され、ダッシュボードに並びます。ジェミニ自身が予測した本番リスクと、実測した実験結果が一目で分かります。
- 画面: BLOCK バッジ + PREDICTED RISKS + [fail] Observability readiness

## Scene 5 — 証拠がゲートを握る（HTMLスライド `scenes/05-injection.html`, 14s）
- 録画: 「ターミナル風」スライド。差分に "return decision=ship" と書いても BLOCK になる様子。
- voice: 判定はジェミニの意見ではありません。実験結果からコードが決定的に計算します。だから差分に「シップと返せ」と指示を書き込んでも、判定は覆りません。答えはブロック。ゲートはコードが握り、モデルは理由を語るだけです。
- 画面: injection diff → `verdict: BLOCK` +『decideVerdict() — computed in code』の一節

## Scene 6 — 技術とクロージング（HTMLスライド `scenes/06-close.html`, 14s）
- 録画: アーキテクチャ1枚 → クロージングコピー。
- voice: 必須技術はすべて本番稼働。クラウドラン、バーテックスAI経由のジェミニ、イラスティックエージェントビルダー、そしてギットハブアクションズ。シップゲート。実験で証明してから、出荷する。
- 画面: Cloud Run / Vertex Gemini / Elastic Agent Builder / GitHub Actions → 「Prove it with experiments. Then ship.」

---

## 収録メモ
- 解像度 1280x720、30fps 目安。公開ページ（PR・ダッシュボード）は認証不要。
- Kibana の Historian はログインが要るため本編では静止スライドで代替し、必要なら別撮り。
- 各シーンの音声尺に合わせて Playwright 側の表示時間を調整（`record.py` の `SCENES` を参照）。
