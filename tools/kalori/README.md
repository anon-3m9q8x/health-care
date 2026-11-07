# 定食チェーンの商品データ取得（kalori.jp）

kalori.jp「お店から探す → 定食」（https://kalori.jp/ja/shops/#shop-cat-teishoku）の全18店舗を対象に、
各店舗の商品一覧と商品ページから栄養成分を取得し、`data_teishoku.js` を作ります。
kalori.jp の robots.txt はクロールを許可していますが、1分60回・1日1,000回／IP の制限があるため、
2秒間隔・429時は待機して再試行します（途中で止めても、取得済みの分から再開できます）。

```sh
python3 -I tools/kalori/crawl_lists.py  WORK/lists                       # 店舗ごとの一覧ページ
python3 -I tools/kalori/parse_lists.py  WORK/lists WORK/list_items.json  # 一覧 → 商品リスト（全2,035品）
python3 -I tools/kalori/crawl_details.py tools/kalori/list_items.json WORK/details tools/kalori_teishoku.json # 商品ページ（取得済みは飛ばす）
python3 tools/kalori_teishoku.py --merge tools/kalori/list_items.json WORK/details  # → tools/kalori_teishoku.json → data_teishoku.js
```

- 一覧の1ページ目にしか栄養値が載らないため、2ページ目以降の商品は商品ページの取得が必要です。
  商品ページが未取得の商品は、栄養値が判明するまでアプリに出しません。
- 公式発表値／AI推定値の区別は kalori の表示どおり（`quality: official / estimate`）。
- 食塩相当量が未取得の商品は、同じ店舗の掲載値（kcal あたり）からの想定値（`est: ["salt"]`）。食物繊維は不明のまま空欄。
