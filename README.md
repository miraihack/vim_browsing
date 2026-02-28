# VimAscii

Web ページを ASCII アートに変換し、Vim スタイルのキーボード操作でブラウジングできるブラウザ拡張機能。画像は ASCII アートに、動画はリアルタイムのカラー ASCII アニメーションに変換される。

## 特徴

- **Vim モーダル操作** — Normal / Command / Visual / Hint / Video の 5 モード
- **ページ全体の ASCII 化** — 見出し・リスト・テーブル・コードブロックを構造ごとテキスト描画
- **画像 → ASCII アート** — 70 段階の輝度ランプで高精細に変換
- **動画 → カラー ASCII** — 12 FPS でフレームキャプチャし、RGB カラー付き ASCII をリアルタイム表示
- **リンクヒント** — `f` キーで画面上のリンクに 1 文字ラベルを表示、キー 1 つでジャンプ
- **検索** — `/` でインクリメンタル検索、`n` / `N` でジャンプ
- **Catppuccin Mocha テーマ** — ダークカラースキームで目に優しい

## インストール

### ビルド

```bash
npm install
npm run build          # Chrome + Firefox 両方
npm run build:chrome   # Chrome のみ
npm run build:firefox  # Firefox のみ
npm run watch          # ファイル変更時に自動リビルド
```

ビルドツールには [esbuild](https://esbuild.github.io/) を使用。各エントリポイント (`background.js`, `content.js`) を IIFE 形式にバンドルし、`dist-chrome/` と `dist-firefox/` にそれぞれ出力する。watch モードではソースマップも生成される。

### Chrome

1. `chrome://extensions` を開く
2. 右上の **デベロッパーモード** を ON
3. **パッケージ化されていない拡張機能を読み込む** → `dist-chrome/` フォルダを選択

### Firefox

1. `about:debugging#/runtime/this-firefox` を開く
2. **一時的なアドオンを読み込む** → `dist-firefox/manifest.json` を選択

### 起動

ツールバーの VimAscii アイコンをクリックするとオーバーレイが起動する。もう一度クリックで終了。

## キーバインド

### Normal モード

| キー | 動作 |
|------|------|
| `h` `j` `k` `l` | カーソル移動 (左 / 下 / 上 / 右) |
| `0` | 行頭へ |
| `$` | 行末へ |
| `^` | 最初の非空白文字へ |
| `w` | 次の単語へ |
| `b` | 前の単語へ |
| `gg` | ドキュメント先頭へ |
| `G` | ドキュメント末尾へ |
| `Ctrl-d` | 半ページ下スクロール |
| `Ctrl-u` | 半ページ上スクロール |
| `Ctrl-f` | 1 ページ下スクロール |
| `Ctrl-b` | 1 ページ上スクロール |
| `Enter` | カーソル行のリンクを開く / 動画なら Video モードへ |
| `f` | Hint モード (リンク選択) |
| `v` | Visual モード |
| `/` | 検索モード |
| `n` / `N` | 次 / 前の検索結果 |
| `:` | Command モード |
| `ZZ` | VimAscii を終了 |
| `Escape` | ハイライト解除 |

### Command モード (`:`)

| コマンド | 動作 |
|----------|------|
| `:q` `:quit` `:wq` `:x` | 終了 |
| `:{数字}` | 指定行へジャンプ |
| `Escape` | Command モードを抜ける |

### Visual モード (`v`)

| キー | 動作 |
|------|------|
| `h` `j` `k` `l` | 選択範囲を拡張 |
| `y` | 選択テキストをクリップボードにコピー |
| `v` / `Escape` | Visual モードを抜ける |

### Hint モード (`f`)

画面上のリンクに `a`–`z` のラベルが表示される。対応するキーを押すとそのリンクを開く。

### Video モード (`Enter` で動画上にて起動)

| キー | 動作 |
|------|------|
| `Space` | 再生 / 一時停止 |
| `h` / `l` | 5 秒巻き戻し / 早送り |
| `j` / `k` | 音量下げ / 上げ |
| `m` | ミュート切替 |
| `[` / `]` | 再生速度を 0.25x ずつ変更 |
| `q` / `Escape` | Video モードを終了 |

---

## アーキテクチャ

### ファイル構成

```
src/
├── background/
│   └── background.js        # Service Worker / バックグラウンドスクリプト
├── content/
│   ├── content.js            # コンテンツスクリプト (エントリポイント)
│   ├── content.css           # Catppuccin Mocha テーマの CSS
│   ├── dom-parser.js         # DOM → ブロックモデル変換
│   ├── ascii-converter.js    # 画像 → ASCII アート変換
│   ├── video-ascii.js        # 動画 → カラー ASCII リアルタイム再生
│   ├── vim-overlay.js        # Shadow DOM UI コンテナ
│   ├── vim-renderer.js       # ブロック → バッファ行変換
│   ├── vim-keybindings.js    # Vim モーダルキーバインド
│   ├── vim-statusline.js     # ステータスライン
│   └── vim-commandline.js    # コマンド / 検索入力バー
├── shared/
│   ├── constants.js          # 全定数 (色・モード・キー設定)
│   └── browser-api.js        # Chrome / Firefox API ラッパー
├── icons/
│   └── icon{16,48,128}.png
└── manifest.base.json        # Manifest V3 テンプレート
```

### モジュール依存グラフ

```
content.js (エントリポイント)
├── browser-api.js
├── dom-parser.js ─── constants.js
├── ascii-converter.js
│   ├── constants.js
│   └── browser-api.js ──→ background.js (CORS迂回フェッチ)
├── vim-renderer.js (純粋関数、外部依存なし)
└── vim-overlay.js
    ├── constants.js
    ├── vim-statusline.js ─── constants.js
    ├── vim-commandline.js
    └── vim-keybindings.js
        ├── constants.js
        └── video-ascii.js ─── constants.js
```

### 起動パイプライン

ツールバーアイコンがクリックされると、`background.js` がアクティブタブへメッセージを送信し、`content.js` が以下の 5 フェーズを順次実行する。

1. **DOM パース** — ページ全体を再帰走査し、ブロックモデルに変換
2. **YouTube フォールバック** — `<video>` 要素を直接検出してプレースホルダを差し込む
3. **画像変換** — 全画像を非同期並列で ASCII アートに変換 (`Promise.all`)
4. **レンダリング** — ブロックをワードラップしてバッファ行の配列に変換
5. **UI 表示** — Shadow DOM オーバーレイを生成し、キーバインドをアタッチ

---

## 使用技術の詳細

### Shadow DOM によるスタイル隔離

`vim-overlay.js` は `attachShadow({mode: 'closed'})` で閉じた Shadow DOM を生成し、その中に Vim UI 全体を構築する。ページ側の CSS が UI に干渉せず、逆に拡張のスタイルがページを汚染しないことを保証する。Shadow DOM 内には `content.css` のスタイルがインラインで注入される。

### DOM パーサー — CSS レイアウト対応のコンテンツ抽出

`dom-parser.js` はページの DOM ツリーを再帰的に走査し、CSS のレイアウト情報を読み取りながら構造化ブロックに変換する。

- **`getComputedStyle()`** でインデント・text-align・text-transform・letter-spacing 等を取得
- **`getBoundingClientRect()`** でピクセル座標を文字単位に変換 (`1ch ≈ 8.4px`, `1行 ≈ 19.6px`)
- **不可視テキスト検出** — WCAG 2.0 準拠の sRGB 相対輝度計算 (`0.2126R + 0.7152G + 0.0722B`) でテキスト色と背景色のコントラスト比を判定し、隠しテキストを除外
- **レイアウトコンテキストスタック** — ブロック要素の入れ子に応じてインデント幅・テキスト配置・利用可能幅をスタックで管理し、離脱時に復元
- **インデント正規化** — CSS の `margin: 0 auto` 等による全体的なオフセットを検出・除去し、過大なインデントは表示幅の 25% に制限
- **テーブルレンダリング** — 各列の最大テキスト長と CSS 幅を比較し、利用可能幅を超える場合は比例縮小。ヘッダは `=`、通常行は `-` で罫線を描画
- **インラインリンク抽出** — `<a>` タグを再帰走査し、テキスト位置と `href` のメタデータ (`{start, end, href}`) を記録

### 画像 → ASCII アート変換

`ascii-converter.js` は Canvas API を使って画像ピクセルを ASCII 文字に変換する。

**3 段階フォールバック戦略:**

1. **同一オリジン直接描画** — `ctx.drawImage(imgElement)` で DOM 要素をそのまま Canvas に描画 (最速)
2. **data: / blob: URL** — `new Image()` に URL をロードして描画 (CORS 不要)
3. **バックグラウンドスクリプト経由** — `background.js` が `fetch()` (host_permissions により CORS 制約なし) で画像を取得し、ArrayBuffer → Base64 data URL に変換して返送。8KB チャンク単位で `String.fromCharCode()` を呼ぶことでコールスタックオーバーフローを回避

**輝度 → 文字マッピング:**

```
輝度 = 0.299R + 0.587G + 0.114B    (ITU-R BT.601)
文字 = ASCII_RAMP[floor((輝度 / 255) × 69)]
```

70 文字の Paul Bourke ランプ (暗→明):

```
 .'`^",:;Il!i><~+_-?][}{1)(|\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$
```

アルファ値が 128 未満のピクセルはスペースに置換 (透過処理)。出力サイズは最大幅 140 文字・最大高 150 行で、アスペクト比補正 (`CHAR_ASPECT_RATIO = 0.5`) を適用する。

### 動画 → カラー ASCII リアルタイム再生

`video-ascii.js` は HTML5 Video API と Canvas API を組み合わせ、動画フレームをリアルタイムでカラー ASCII に変換する。

**フレームキャプチャループ:**

`requestAnimationFrame` ベースのループで、タイムスタンプ差分によるスロットリングを行い 12 FPS を維持する。ドリフト補正 (`elapsed % frameInterval` の減算) により長期的なフレーム蓄積を防止。Canvas コンテキストには `willReadFrequently: true` ヒントを付与し、`getImageData()` の繰り返し呼び出しを最適化。

**カラー ASCII レンダリング — ランレングスエンコーディング:**

各ピクセルの RGB 値をビットシフト (`>> 3`) で 32 段階に量子化し (32³ = 32,768 色)、行ごとに同色の連続文字を 1 つの `<span style="color:rgb(r,g,b)">` にグルーピングする。これにより DOM ノード数を大幅に削減しつつ、ピクセル単位の色情報を保持する。

```html
<span style="color:rgb(32,64,128)">.:;Il</span>
<span style="color:rgb(160,96,0)">*#MW</span>
```

生成した HTML 文字列は `innerHTML` で一括代入する。DRM 保護コンテンツ等で Canvas がテイントされた場合は `textContent` にフォールバックしてエラーメッセージを表示する。

**ビューポート適応:**

コンテナサイズから文字グリッド寸法 (`cols × rows`) を算出し、動画のアスペクト比に合わせて列数または行数を縮小する。

### 仮想スクロール

`vim-overlay.js` はバッファ全体を DOM に展開せず、ビューポート内の行だけをレンダリングする仮想スクロールを実装する。

- **行高の動的測定** — プローブ用の `<div>` を一時挿入して `getBoundingClientRect().height` を取得 (フォールバック: 19.6px)
- **`ResizeObserver`** でコンテナのリサイズを検知し、ビューポート行数を再計算
- **`DocumentFragment`** による一括 DOM 挿入でリフローを最小化
- **`requestAnimationFrame`** で描画リクエストをデデュプリケーション (`_renderScheduled` フラグ)
- **ホイールイベント** を `capture: true` でインターセプトし、ページのスクロールをブロック

### カーソルと検索ハイライト

- **カーソル描画** — 対象行のテキストをカーソル位置で分割し、カーソル文字を `<span class="vim-cursor">` でラップ (CSS で色を反転)
- **検索ハイライト** — `TreeWalker` (`NodeFilter.SHOW_TEXT`) でテキストノードを収集し、パターンにマッチする部分を `<span class="vim-search-match">` で囲む。現在のマッチには `vim-search-current` クラスを付与 (別色で強調)。ライブ NodeList の変更による無限ループを避けるため、ノードリストのスナップショットを先に取得する

### Vim キーバインドエンジン

`vim-keybindings.js` は `keydown` イベント (capture フェーズ) を単一リスナーで受け取り、現在のモードに応じたハンドラにディスパッチするステートマシンを実装する。

- **マルチキーシーケンス** — `g` や `Z` の初回入力を保持し、500ms 以内に次のキーが来なければリセット (`setTimeout`)
- **IME 対応** — `event.isComposing` と `keyCode === 229` をチェックし、日本語入力中のキーイベントを無視
- **Clipboard API** — Visual モードの `y` (ヤンク) で `navigator.clipboard.writeText()` を呼び出し、選択範囲をクリップボードにコピー
- **ヒントモード** — ビューポート内のリンクを収集し、`asdfghjklqwertyuiopzxcvbnm` の 1 文字ラベルを割り当て。キー 1 つでリンク先に遷移

### ブロック → バッファ行変換

`vim-renderer.js` はパーサーが生成したブロックモデルをフラットな行配列に変換する純粋関数モジュール。

- **ワードラップ** — 貪欲法で利用可能幅に収まる最後のスペースで改行。スペースがない場合は幅で強制改行
- **ハンギングインデント** — リストマーカー (`●`, `1.` 等) を検出し、2 行目以降はマーカー幅分だけインデントを追加
- **リンクオフセット追跡** — テキストが複数行に折り返される際、元のリンク位置 (`{start, end}`) を折り返し後の各行にマッピングし直す

### クロスブラウザ互換

`browser-api.js` は Chrome と Firefox の拡張 API 差異を吸収するラッパー。

- `typeof browser !== 'undefined'` で Firefox を検出し、なければ `chrome` オブジェクトを使用
- `action` (MV3) と `browserAction` (レガシー) の自動フォールバック
- Manifest V3 のバックグラウンドスクリプト指定も `build.js` 内で Chrome (`service_worker`) / Firefox (`scripts`) を分岐生成

### テーマ — Catppuccin Mocha

UI 全体に Catppuccin Mocha ダークテーマを適用。`constants.js` に定義された 16 色のパレットを使用:

| 用途 | 色 |
|------|------|
| 背景 | `#1e1e2e` |
| テキスト | `#cdd6f4` |
| 見出し | `#f38ba8` (ピンク) |
| リンク | `#89b4fa` (ブルー) |
| コード | `#a6e3a1` (グリーン) |
| 検索マッチ | `#f9e2af` (イエロー) |
| カーソル | `#f5e0dc` |
| NORMAL モード | `#89b4fa` (ブルー) |
| VISUAL モード | `#cba6f7` (パープル) |
| COMMAND モード | `#f9e2af` (イエロー) |
| VIDEO モード | `#f38ba8` (ピンク) |

CSS レイアウトには `grid-template-rows: 1fr auto auto` (バッファ / ステータスライン / コマンドライン) を使用し、`position: fixed` で画面全体を覆う。

---

## 動作要件

- Chrome 109+ / Firefox 109+
- Manifest V3

## ライセンス

MIT
