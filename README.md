# 誤答理由判定機能付き ディクテーション プラットフォーム (仮名)

タイピング学習を変える、究極の学習プラットフォームを作成中です！！

詳細は随時公開予定！！

## 現在の開発: Chrome拡張・学習UI・クリップ起動

現在の開発対象は [`new/`](new/) のChrome MV3拡張です。動画と区間を選び、通常のTyping・Hint・Config・Subtitleパネルで学習します。拡張不要の[Webデモ](https://gpioblink.com/video-typing/)も同じUIを使います。

Node.js 24 / pnpm 10.12.4:

```sh
cd new
pnpm install --frozen-lockfile
pnpm dev:web
```

拡張は `pnpm build` 後の `.output/chrome-mv3` をChromeに読み込み、開いている動画のポップアップから区間を指定して起動します。おすすめボタンは独立したWebデモを開きます。

開発・検証コマンド、設計、今回のライセンス確認済み字幕の取り扱い、YouTube / Netflixの制約と実機確認は [C109開発メモ](new/docs/c109.md) を参照してください。

## 初期プロトタイプの進捗状況

今は、タイピング部分のコンポーネントなどをstorybook上で開発している段階です。

只今、storybook上で、キーボード関連のコンポーネントを公開しています！

https://video-typing.gpioblink.now.sh/
