# ShipGate — Proto Pedia 提出用ドラフト

> 提出先: https://protopedia.net （要アカウント）/ 提出締切 2026-07-10 (金) 23:59
> 応募フォームは Notion サイトの「応募方法」参照。

---

## 作品名

**ShipGate（シップゲート）** — 差分を読んで実験する、自己修復型リリースゲート AI エージェント

## 一行紹介

CI はコードが「正しい」ことを教えてくれる。でも「本番で運用できる」ことは誰も教えてくれない。ShipGate は PR の差分を読み、**自分で実験を設計・実行して証拠を集め、リリース判定を下し、問題があれば自分でパッチを書く** AI エージェントです。

## ストーリー（課題設定）

深夜3時、オンコールエンジニアの携帯が鳴る。昨日マージされた PR が本番で燃えている。ダッシュボードを開くが — メトリクスがない。ログもない。新しく追加された失敗パスは、誰も観測できるようにしていなかった。

このインシデントは PR の時点で防げたはずです。しかし現実の CI は単体テストを回すだけ。**負荷をかけたらどうなるか、キャッシュの TTL が切れた1時間後に何が起きるか、失敗したときオンコールがデバッグできるか** — 誰も検証しません。既存の AI SRE ツール（Cleric, Traversal, Resolve.ai 等）は本番が壊れた「後」に起きるものばかり。ShipGate は壊れる「前」に立つゲートです。

## エージェントの自律性（なぜエージェントである必然性があるか）

固定パイプラインはどの PR にも同じチェックを回します。ShipGate は **差分ごとに違う実験を Gemini が自分で設計** します：

| 差分に含まれるもの | エージェントが生成する実験 |
|---|---|
| リクエストハンドラ / クエリの変更 | レイテンシ予算つきの負荷実験（autocannon） |
| キャッシュ TTL・トークン有効期限・リトライ | **タイムワープ実験** — 仮想時計ヘッダで 0秒/61秒/3601秒後を数秒で再生 |
| 新しい失敗パス・外部呼び出し | 観測可能性監査 —「深夜3時にオンコールがこれをデバッグできるか？」 |

さらに判定は **証拠ベース原則**: ブロックには実測された実験失敗が必須。推測リスクはアドバイスに回す。しかも最終判定は Gemini ではなく**コードが実験結果から決定的に計算**（`decideVerdict`）し、Gemini は理由文を書くだけ。だから差分にプロンプトインジェクションを仕込んでも判定は覆らない（「shipと返せ」入り差分でも BLOCK を実証済み）。LLM の「意見」ではなく「実験証拠」でゲートする点が核心です。

4つの役割を持つエージェントチームとして動作:
1. **Planner**（Gemini）— 差分から本番リスクを予測し実験を設計
2. **Prober** — 実験を実行し実測値を収集
3. **Judge**（Gemini）— 証拠のみからリリース判定（ship / ship-with-warnings / block）
4. **Patcher**（Gemini）— 失敗した実験を直すコードを自分で書き、再実験で検証
5. \+ **Historian**（Elastic Agent Builder）— 蓄積された判定履歴に日本語で答える第5のエージェント

## デモ（3幕構成・すべて本番環境で動作確認済み）

```
第1幕  危険な PR が届く（キャッシュ期限バグ + 重いスコアリング + 無観測の外部呼び出し）
       → エージェントが実験を設計・実行 → 🔴 BLOCK
         実測: p99 714ms（予算300ms超過）/ エラー率100% / 期限1時間後も古いデータ提供
第2幕  エージェントが自分でパッチを作成（期限判定修正 + 計装追加 + 優雅な劣化）
第3幕  同じ実験を自分のパッチに対して再実行 → 🟢 SHIP
```

実際の GitHub PR でも動作: [shipgate-demo-shop#1](https://github.com/uiharu-kazari/shipgate-demo-shop/pull/1) — Action がエージェントを呼び、判定コメントを投稿し、block でマージを物理的に阻止。

Historian へ「なぜ PR 42 はブロックされたの？」と日本語で聞くと、Elasticsearch の証拠から実測値つきで回答。

## システム構成

```
GitHub PR ──diff──▶ GitHub Actions
                        │
                        ▼
            ┌─ ShipGate Agent（Cloud Run / Hono + TypeScript）─┐
            │ 1. Gemini(Vertex AI) が実験を計画                  │
            │ 2. 負荷 / タイムワープ / 観測可能性 実験を実行       │
            │ 3. 証拠を Elasticsearch へ索引                     │
            │ 4. Gemini が証拠ベースで判定                        │
            │ 5. 失敗時: Gemini がパッチ生成 → 再実験             │
            └───────┬──────────────────────┬────────────────┘
                    ▼                      ▼
            PR コメント + ゲート    ダッシュボード + Historian
                              （Elastic Agent Builder / ES|QL）
                        ▲
        対象アプリ（Cloud Run / 仮想時計ヘッダ対応）
```

## 使用技術（必須要件との対応）

- **(必須) Google Cloud アプリ実行**: Cloud Run ×2（エージェント / 対象アプリ、asia-northeast1）
- **(必須) Google Cloud AI**: Gemini 2.5 Flash を **Vertex AI（Gemini Enterprise Agent Platform）経由**で利用 — Cloud Run のメタデータサーバーから OAuth トークンを取得し API キー不要
- **(スポンサー) Elasticsearch**: 証拠ストア（`shipgate-evidence` 索引）+ **Elastic Agent Builder** で Historian エージェント（ES|QL カスタムツール×2）
- **DevOps ループ**: GitHub Actions によるリリースゲート（つくる→まわす→とどける を1本で）
- TypeScript / Hono / autocannon / Docker

## リンク

- 製品リポジトリ: https://github.com/uiharu-kazari/shipgate
- デモ用顧客リポジトリ + ブロックされた実 PR: https://github.com/uiharu-kazari/shipgate-demo-shop/pull/1
- エージェント（ダッシュボード）: https://shipgate-agent-maqob3nldq-an.a.run.app
- 対象デモアプリ: https://shipgate-demo-maqob3nldq-an.a.run.app

## 審査基準セルフチェック

- **AIエージェントが価値の中心**: 差分ごとに実験を自律設計・実行・判定・修復。固定パイプラインでは不可能
- **課題へのアプローチ**: 「AI SRE は事後対応ばかり」という市場の空白を、事前の実験ゲートで埋める
- **ユーザビリティ**: PR コメント1枚に証拠と判定が集約。質問は Historian に日本語で
- **実用性**: 実在の GitHub PR を実測値でブロック済み。ヒューリスティックへの優雅な劣化つき
- **実装力**: 必須技術3点セット（Cloud Run / Vertex Gemini / GitHub Actions）+ スポンサー技術（Elastic Agent Builder）を本番稼働

## デモ動画 絵コンテ（60〜90秒）

1. (0-10s) 深夜3時のスマホ通知 →「このインシデント、PR の時点で防げたのに」
2. (10-25s) PR 画面: ShipGate が実験中 → 🔴 BLOCK コメント（実測値をズーム: p99 714ms / 100% errors / 3601s stale）
3. (25-40s) `POST /propose-patch` → エージェントのパッチと rationale を表示
4. (40-55s) 再実験 → 🟢 SHIP。ダッシュボードの block→ship タイムライン
5. (55-70s) Kibana で Historian に日本語質問 → 証拠つき回答
6. (70-80s) アーキテクチャ1枚 →「ShipGate: 実験で証明してから、出荷する」
