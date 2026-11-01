# 誤答理由判定機能付き ディクテーション プラットフォーム (仮名)

タイピング学習を変える、究極の学習プラットフォームを作成中です！！

詳細は随時公開予定！！

## 現在の開発: Chrome拡張・C109即プレイ

現在の開発対象は [`new/`](new/) のChrome MV3拡張です。おすすめの40秒動画を、字幕ファイルの準備なしでプレイできます。同じ画面を使う拡張不要のWebデモもあります。

Node.js 24 / pnpm 10.12.4:

```sh
cd new
pnpm install --frozen-lockfile
pnpm dev:web
```

拡張は `pnpm build` 後の `.output/chrome-mv3` をChromeに読み込み、ポップアップの「おすすめをすぐプレイ · 40秒」から起動します。

開発・検証コマンド、設計、サンプルの権利、YouTube / Netflixの制約と実機確認は [C109開発メモ](new/docs/c109.md) を参照してください。

## 初期プロトタイプの進捗状況

今は、タイピング部分のコンポーネントなどをstorybook上で開発している段階です。

只今、storybook上で、キーボード関連のコンポーネントを公開しています！

https://video-typing.gpioblink.now.sh/
