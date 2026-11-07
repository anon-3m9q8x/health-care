#!/usr/bin/env python3
"""Build data.js / catalog.json for NutriPath.

Official values already in the catalog (verified from chain pages) are kept as-is.
Every other item is an "想定" (estimated) value derived from its contents:
each product is described as a list of ingredients with gram weights, and the
nutrition is computed from approximate per-100g values based on the Japanese
Standard Tables of Food Composition (MEXT) and typical commercial recipes.
Prices of estimated items are also estimates (price_est=True).

Run:  python3 tools/build_catalog.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MEXT = "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html"

# per 100 g: kcal, protein, fat, carbs, salt, fiber
ING = {
 # staples
 'rice':(156,2.5,0.3,37.1,0,1.5),'onigiri_rice':(156,2.5,0.3,37.1,0.6,1.5),'salad_chicken':(110,24,1.5,0.5,1.1,0),'sushi_rice':(165,2.4,0.3,37.5,0.6,0.4),'sekihan':(186,4.3,0.6,40.6,0,1.6),
 'mochigome':(186,3.5,0.5,41,0,0.4),'bread':(248,8.9,4.1,46.4,1.2,4.2),'bun':(290,9,6,49,1.2,2.0),
 'muffin':(224,8.1,3.6,40.8,1.2,1.2),'croissant':(438,6.5,20.4,51.5,1.2,1.8),'sweet_bun':(330,7,9,55,0.6,1.8),
 'udon':(95,2.6,0.4,21.6,0.3,1.3),'soba':(130,4.8,1.0,26.0,0,2.9),'ramen':(133,4.9,0.6,27.9,0.2,2.8),
 'yakisoba_noodle':(162,4.7,1.7,32,0.4,2.6),'pasta':(150,5.8,0.9,32.2,0,3.0),'oats':(350,13.7,5.7,69.1,0,9.4),
 'tortilla':(300,8,8,49,1.2,2.5),'harusame':(80,0,0.2,20,0,0.8),
 # meat / fish / egg / soy
 'chicken_breast':(105,23.3,1.9,0.1,0.1,0),'chicken_thigh':(190,16.6,14.2,0,0.2,0),'karaage':(260,18,16,11,1.2,0.4),
 'chicken_fried':(250,15,14,15,1.2,0.8),'nugget':(290,16,18,15,1.3,0.8),'yakitori_salt':(200,18,13,1,1.0,0),
 'yakitori_tare':(210,17,12,7,1.6,0),'pork_loin':(248,19.3,19.2,0.2,0.1,0),'pork_belly':(366,14.4,35.4,0.1,0.1,0),
 'pork_koma':(200,18,14,0.2,0.1,0),'tonkatsu':(400,22,30,10,0.3,0.7),'beef_belly':(330,14,32,0.2,0.1,0),
 'gyudon_topping':(200,9,15,8,1.4,0.6),'yakiniku':(260,15,19,7,1.4,0.4),'hamburg':(223,13,13.4,12,1.0,1.0),
 'beef_patty':(260,17,20,3,0.8,0),'sausage':(319,11.5,30.6,3.3,1.9,0),'ham':(211,18.6,14.5,2,2.3,0),
 'bacon':(400,12.9,39.1,0.3,2.0,0),'soboro':(200,15,10,10,2.0,0),'menchi':(273,10,18,18,0.9,1.4),
 'croquette':(230,5,12,25,0.7,1.8),'gyoza':(230,8,12,22,1.2,1.5),'shumai':(210,9,9,20,1.2,1.5),
 'harumaki':(270,6,16,25,1.0,1.2),'salmon_salt':(183,22.4,11.1,0.1,1.8,0),'salmon_grill':(171,29.1,5.1,0.1,0.2,0),
 'saba_salt':(263,20,19,0.3,1.5,0),'saba_can':(174,20.9,10.7,0.2,0.9,0),'tuna_can':(70,16,0.7,0.2,0.5,0),
 'tuna_mayo':(300,10,28,2,0.9,0),'tuna_sashimi':(115,26.4,1.4,0.1,0.1,0),'salmon_sashimi':(223,20,16,0.1,0.1,0),
 'shrimp':(91,20.9,0.3,0.2,0.4,0),'shrimp_tempura':(230,12,12,18,0.5,0.6),'squid':(76,17.9,0.8,0.1,0.5,0),
 'mentaiko':(121,21,3.3,3,5.6,0),'kanikama':(89,12,0.5,9.2,2.2,0),'fish_fry':(250,13,14,17,0.8,0.8),
 'egg':(142,12.2,10.2,0.4,0.4,0),'tamagoyaki':(146,10.5,9.2,6.4,1.2,0),'egg_salad':(230,8.5,20,2.5,1.0,0),
 'tofu_firm':(73,7.0,4.9,1.5,0,1.1),'tofu_soft':(56,5.3,3.5,2.0,0,0.9),'natto':(190,16.5,10,12.1,0,6.7),
 'aburaage':(377,23.4,34.4,0.4,0,1.3),'cheese':(313,22.7,26,1.3,2.8,0),'mapo':(110,7,7,4,1.0,0.5),
 'chikuwa':(119,12.2,2,13.5,2.1,0),
 # dairy
 'milk':(61,3.3,3.8,4.8,0.1,0),'yogurt_plain':(56,3.6,3.0,4.9,0.1,0),'yogurt_sweet':(65,4.3,0.2,11.9,0.2,0),
 'greek_yogurt':(95,10,3,6,0.1,0),'cream':(404,1.9,40,6.5,0.1,0),
 # vegetables / fruit
 'cabbage':(21,1.3,0.2,5.2,0,1.8),'lettuce':(11,0.6,0.1,2.8,0,1.1),'tomato':(20,0.7,0.1,4.7,0,1.0),
 'cucumber':(13,1.0,0.1,3.0,0,1.1),'onion':(33,1.0,0.1,8.4,0,1.5),'carrot':(35,0.7,0.2,8.7,0.1,2.4),
 'potato':(76,1.6,0.1,17.6,0,1.3),'broccoli':(37,5.4,0.6,6.6,0.1,5.1),'spinach':(23,2.6,0.5,4.0,0,3.6),
 'moyashi':(15,1.7,0.1,2.6,0,1.3),'mushroom':(22,2.7,0.3,4.5,0,3.0),'gobou':(58,1.8,0.1,15.4,0,5.7),
 'negi':(35,1.4,0.1,8.3,0,2.5),'pumpkin':(78,1.9,0.3,20.6,0,3.5),'daikon':(15,0.4,0.1,4.1,0,1.4),
 'wakame':(16,1.9,0.2,5.6,0.7,5.8),'corn':(89,3.6,1.7,16.8,0,3.0),'edamame':(125,11.7,6.2,8.9,0,4.6),
 'avocado':(176,2.1,17.5,7.9,0,5.6),'okra':(26,2.1,0.2,6.6,0,5.0),'veg_mix':(25,1.2,0.2,5.5,0,1.8),
 'kimchi':(27,2.3,0.1,5.4,2.9,2.2),'pickles':(30,1.0,0.2,5.0,3.0,2.0),'umeboshi':(33,0.7,0.7,8.6,18.2,3.4),
 'kombu_tsukudani':(150,6,1,33,7,6.8),'nori':(188,41,3.7,44,1.3,36),'nimono':(80,4,2.5,9,1.2,1.8),
 'hijiki_ni':(75,2,3,8,1.6,4.0),'kinpira':(90,1.5,4,11,1.3,3.5),'potato_salad':(130,1.6,8,12,0.9,1.2),
 'macaroni_salad':(180,3.8,11,16,1.0,1.0),'harusame_salad':(90,1.0,3,15,1.1,1.0),'goma_ae':(100,4,5,9,1.0,3.5),
 'banana':(93,1.1,0.2,22.5,0,1.1),'apple':(53,0.1,0.2,15.5,0,1.4),'mikan':(49,0.7,0.1,12,0,1.0),
 'fruit_mix':(60,0.6,0.1,15,0,1.0),'nuts':(600,19,52,22,0,7),'fries':(300,3.6,15.5,37,0.6,3.0),
 'hash_brown':(260,2,16,27,0.6,2.2),
 # sauces / seasonings / soups
 'mayo':(668,1.4,72.5,3.6,1.9,0),'dressing':(250,1,23,10,4.0,0.2),'nonoil_dressing':(80,3,0,16,7.4,0),
 'sauce_sweet':(130,2,0,30,6,0.5),'teriyaki_sauce':(150,2,0,33,6.5,0),'curry_sauce':(100,2.5,5,11,1.1,1.2),
 'meat_sauce':(110,5,6,8,1.2,1.5),'white_sauce':(120,3,8,9,0.9,0.3),'miso_soup':(27,1.7,0.9,2.7,1.0,0.5),
 'tonjiru':(45,2.8,2.4,3.5,0.8,0.9),'udon_soup':(25,1.0,0,4.5,1.6,0),'ramen_soup':(50,1.5,3,4,1.7,0),
 'consomme':(10,0.5,0.1,1.5,0.6,0.3),'cream_soup':(80,2,4.5,8,0.7,0.6),'ponzu':(60,3,0,11,7,0),
 # cooked composites
 'fried_rice':(200,4.7,6.8,31,1.0,0.6),'napolitan':(160,4.5,5,24,1.0,1.2),'yakisoba_cooked':(170,5,6.5,22,1.2,1.5),
 'omelet_rice':(170,5.5,6,24,0.9,0.6),'yasai_itame':(80,4,5,5,0.8,1.6),'nikujaga':(90,4,3,12,1.0,1.4),
 'saba_miso':(220,16,14,7,1.2,0.2),'shogayaki':(240,16,17,6,1.3,0.5),'oyako_topping':(110,9,5,7,1.2,0.4),
 'chirashi_topping':(120,8,2,17,1.6,0.5),'katsu_topping':(250,13,15,15,1.1,0.6),'gomoku':(150,3.5,3,27,0.9,1.0),
 'inari':(210,5,6,32,1.2,0.8),'dorayaki':(285,6.6,3.1,58.7,0.4,1.9),'onsen_egg':(140,11.7,9.6,1.5,0.5,0),
 # sweets / snacks
 'sponge':(283,7,7,47,0.2,0.8),'custard':(210,4.5,7,32,0.1,0.2),'chocolate':(550,7,34,56,0.2,3.9),
 'anko':(244,5.6,0.6,54,0,5.7),'mochi':(223,4,0.6,50.8,0,0.5),'ice':(217,3,13,23,0.2,0),
 'pudding':(126,5.5,5,14.7,0.2,0),'cookie':(500,6,24,65,0.6,1.5),'chips':(541,4.7,35.2,54.7,1.0,4.2),
 'senbei':(370,7,1,85,1.5,0.6),'protein_bar':(400,30,16,38,0.6,8),'granola':(450,8,15,70,0.5,8),
 'jelly':(60,0,0,15,0,0.3),
 # drinks (per 100 ml)
 'tea':(0,0,0,0.1,0,0),'coffee':(4,0.2,0,0.7,0,0),'latte':(45,2,2,4.5,0.1,0),'cola':(46,0,0,11.4,0,0),
 'orange_juice':(42,0.7,0,10.7,0,0.2),'veg_juice':(30,0.6,0,7,0.1,0.7),'soy_milk':(44,3.6,2.0,3.1,0,0.2),
 'protein_drink':(50,6,0.2,6,0.1,0),'sports_drink':(21,0,0,5.1,0.1,0),'shake':(110,2.5,3,18,0.2,0),
 'smoothie':(50,0.6,0.2,12,0,0.8),
}


JA = {'rice':'ご飯','onigiri_rice':'ご飯(塩)','salad_chicken':'鶏むね肉(味付)','sushi_rice':'酢飯','sekihan':'赤飯','mochigome':'もち米','bread':'食パン','bun':'バンズ','muffin':'マフィン','croissant':'パイ生地','sweet_bun':'菓子パン生地',
'udon':'うどん','soba':'そば','ramen':'中華麺','yakisoba_noodle':'蒸し麺','pasta':'パスタ','oats':'オートミール','tortilla':'トルティーヤ','harusame':'春雨',
'chicken_breast':'鶏むね肉','chicken_thigh':'鶏もも肉','karaage':'唐揚げ','chicken_fried':'フライドチキン','nugget':'ナゲット','yakitori_salt':'焼き鳥(塩)','yakitori_tare':'焼き鳥(たれ)',
'pork_loin':'豚ロース','pork_belly':'豚ばら','pork_koma':'豚こま','tonkatsu':'とんかつ','beef_belly':'牛ばら','gyudon_topping':'牛丼の具','yakiniku':'焼肉','hamburg':'ハンバーグ',
'beef_patty':'ビーフパティ','sausage':'ソーセージ','ham':'ハム','bacon':'ベーコン','soboro':'鶏そぼろ','menchi':'メンチカツ','croquette':'コロッケ','gyoza':'餃子','shumai':'焼売',
'harumaki':'春巻','salmon_salt':'塩鮭','salmon_grill':'鮭','saba_salt':'焼き魚','saba_can':'サバ水煮','tuna_can':'ツナ','tuna_mayo':'ツナマヨ','tuna_sashimi':'まぐろ',
'salmon_sashimi':'サーモン','shrimp':'えび','shrimp_tempura':'えび天','squid':'いか','mentaiko':'明太子','kanikama':'練り物','fish_fry':'白身フライ','egg':'卵','tamagoyaki':'卵焼き',
'egg_salad':'たまごサラダ','tofu_firm':'木綿豆腐','tofu_soft':'絹豆腐','natto':'納豆','aburaage':'油揚げ','cheese':'チーズ','mapo':'麻婆豆腐','chikuwa':'ちくわ',
'milk':'牛乳','yogurt_plain':'無糖ヨーグルト','yogurt_sweet':'加糖ヨーグルト','greek_yogurt':'ギリシャヨーグルト','cream':'バター・クリーム',
'cabbage':'キャベツ','lettuce':'レタス','tomato':'トマト','cucumber':'きゅうり','onion':'玉ねぎ','carrot':'にんじん','potato':'じゃがいも','broccoli':'ブロッコリー',
'spinach':'ほうれん草','moyashi':'もやし','mushroom':'きのこ','gobou':'ごぼう','negi':'ねぎ','pumpkin':'かぼちゃ','daikon':'大根','wakame':'わかめ','corn':'コーン',
'edamame':'枝豆','avocado':'アボカド','okra':'オクラ','veg_mix':'野菜','kimchi':'キムチ','pickles':'漬物','umeboshi':'梅干し','kombu_tsukudani':'昆布佃煮','nori':'海苔',
'nimono':'煮物','hijiki_ni':'ひじき煮','kinpira':'きんぴら','potato_salad':'ポテトサラダ','macaroni_salad':'マカロニサラダ','harusame_salad':'春雨サラダ','goma_ae':'胡麻和え',
'banana':'バナナ','apple':'りんご','mikan':'みかん','fruit_mix':'果物','nuts':'ナッツ','fries':'フライドポテト','hash_brown':'ハッシュポテト',
'mayo':'マヨネーズ','dressing':'ドレッシング','nonoil_dressing':'ノンオイルドレッシング','sauce_sweet':'甘辛だれ','teriyaki_sauce':'照り焼きソース','curry_sauce':'カレーソース',
'meat_sauce':'ミートソース','white_sauce':'ホワイトソース','miso_soup':'味噌汁','tonjiru':'豚汁','udon_soup':'つゆ','ramen_soup':'スープ','consomme':'コンソメスープ',
'cream_soup':'クリームスープ','ponzu':'ポン酢','fried_rice':'炒飯','napolitan':'ナポリタン','yakisoba_cooked':'焼きそば','omelet_rice':'オムライス','yasai_itame':'野菜炒め',
'nikujaga':'肉じゃが','saba_miso':'魚の味噌煮','shogayaki':'生姜焼き','oyako_topping':'親子煮','chirashi_topping':'ちらし具材','katsu_topping':'かつ煮','gomoku':'五目ご飯',
'inari':'いなり','dorayaki':'どら焼き','onsen_egg':'温泉卵','sponge':'スポンジ生地','custard':'カスタード','chocolate':'チョコレート','anko':'あんこ','mochi':'もち',
'ice':'アイス','pudding':'プリン','cookie':'クッキー生地','chips':'ポテトチップス','senbei':'せんべい','protein_bar':'プロテインバー','granola':'グラノーラ','jelly':'ゼリー',
'tea':'茶','coffee':'コーヒー','latte':'カフェラテ','cola':'コーラ','orange_juice':'オレンジジュース','veg_juice':'野菜ジュース','soy_milk':'豆乳','protein_drink':'プロテイン飲料',
'sports_drink':'スポーツドリンク','shake':'シェイク','smoothie':'スムージー'}

def calc(comps):
    tot = [0.0]*6
    for key, g in comps:
        v = ING[key]
        for i in range(6):
            tot[i] += v[i]*g/100
    kcal, p, f, c, s, fi = tot
    return dict(kcal=round(kcal), protein=round(p,1), fat=round(f,1), carbs=round(c,1), salt=round(s,1), fiber=round(fi,1))

def parse(spec):
    out = []
    for part in spec.split(','):
        k, g = part.strip().split(':')
        out.append((k, float(g)))
    return out

# (store, name, kind, price, comps[, time])
ITEMS = []
def add(store, rows):
    for r in rows:
        ITEMS.append((store,)+tuple(r))

# ---------------------------------------------------------------- 自炊
add('自炊', [
 ('ご飯150g（炊飯後）','rice',55,'rice:150'),
 ('ご飯200g（炊飯後）','rice',73,'rice:200'),
 ('玄米ご飯150g','rice',60,'rice:150'),
 ('食パン6枚切り1枚','main',25,'bread:60'),
 ('トースト（バター少量）','main',35,'bread:60,cream:4'),
 ('オートミール40g（牛乳がけ）','rice',85,'oats:40,milk:150'),
 ('ゆで卵1個','protein',30,'egg:50'),
 ('目玉焼き1個','protein',32,'egg:50,mayo:1'),
 ('卵焼き（卵2個）','protein',65,'tamagoyaki:110'),
 ('納豆1パック＋たれ','protein',37,'natto:45,sauce_sweet:5'),
 ('冷奴（木綿150g）','protein',60,'tofu_firm:150,negi:5,ponzu:8'),
 ('鶏むね肉の蒸し焼き150g（皮なし）','protein',150,'chicken_breast:150,dressing:5'),
 ('鶏もも肉の照り焼き','protein',180,'chicken_thigh:130,teriyaki_sauce:15'),
 ('豚の生姜焼き','protein',220,'shogayaki:150,cabbage:50'),
 ('鮭の塩焼き1切れ','protein',200,'salmon_salt:80'),
 ('サバの味噌煮','protein',210,'saba_miso:120'),
 ('サバ水煮缶100g','protein',160,'saba_can:100'),
 ('麻婆豆腐','protein',150,'mapo:250'),
 ('肉じゃが','vegetable',170,'nikujaga:220'),
 ('野菜炒め','vegetable',150,'yasai_itame:220'),
 ('ブロッコリー100g（温野菜）','vegetable',90,'broccoli:100'),
 ('キャベツ100g（生）','vegetable',35,'cabbage:100'),
 ('ほうれん草のおひたし','vegetable',90,'spinach:80,ponzu:5'),
 ('トマト1個','vegetable',85,'tomato:150'),
 ('きのこのソテー','vegetable',70,'mushroom:100,cream:3'),
 ('具だくさん味噌汁','soup',60,'miso_soup:180,tofu_soft:30,wakame:10,negi:5'),
 ('豚汁','soup',100,'tonjiru:250,pork_belly:15,daikon:30,carrot:15'),
 ('野菜たっぷりスープ','soup',80,'consomme:200,veg_mix:120'),
 ('無糖ヨーグルト150g','protein',70,'yogurt_plain:150'),
 ('牛乳200ml','drink',45,'milk:206'),
 ('バナナ1本','fruit',35,'banana:100'),
 ('りんご1/2個','fruit',70,'apple:120'),
 ('無塩ミックスナッツ20g','snack',65,'nuts:20'),
 ('カレーライス','meal',250,'rice:230,curry_sauce:200,pork_koma:40'),
 ('親子丼','meal',230,'rice:230,oyako_topping:200'),
 ('牛丼（自炊）','meal',260,'rice:230,gyudon_topping:120'),
 ('チャーハン','meal',150,'fried_rice:300'),
 ('オムライス','meal',200,'omelet_rice:350'),
 ('ミートソーススパゲッティ','meal',220,'pasta:240,meat_sauce:150'),
 ('ナポリタン','meal',180,'napolitan:330'),
 ('焼きそば','meal',160,'yakisoba_cooked:330'),
 ('かけうどん','meal',90,'udon:230,udon_soup:300,negi:5'),
 ('肉うどん','meal',190,'udon:230,udon_soup:300,beef_belly:40,onion:20'),
 ('鶏むね肉・野菜・ご飯の自炊プレート','meal',330,'rice:180,chicken_breast:150,broccoli:80,tomato:60,dressing:8'),
 ('納豆・卵・ご飯の朝定食','meal',170,'rice:180,natto:45,egg:50,miso_soup:150,sauce_sweet:5'),
 ('焼き鮭・野菜・ご飯の定食','meal',350,'rice:180,salmon_salt:80,spinach:70,miso_soup:150'),
 ('豆腐・鶏肉・野菜の鍋とご飯','meal',320,'rice:180,tofu_firm:150,chicken_thigh:80,cabbage:100,mushroom:50,ponzu:20'),
 ('豚の生姜焼き定食','meal',330,'rice:200,shogayaki:150,cabbage:60,miso_soup:150'),
])

# ---------------------------------------------------------------- 一般スーパー（どのスーパーにもある定番）
add('一般スーパー', [
 ('納豆3パック（1パック分）','protein',35,'natto:45,sauce_sweet:5'),
 ('絹ごし豆腐150g','protein',45,'tofu_soft:150'),
 ('卵（1個）','protein',28,'egg:50'),
 ('サラダチキン プレーン','protein',230,'chicken_breast:110'),
 ('サバ水煮缶','protein',180,'saba_can:150'),
 ('ツナ缶（水煮）','protein',130,'tuna_can:70'),
 ('魚肉ソーセージ','protein',60,'kanikama:70'),
 ('ちくわ2本','protein',50,'chikuwa:60'),
 ('プレーンヨーグルト（1食分100g）','protein',40,'yogurt_plain:100'),
 ('ギリシャヨーグルト','protein',160,'greek_yogurt:113'),
 ('牛乳200ml','drink',45,'milk:206'),
 ('無調整豆乳200ml','drink',60,'soy_milk:200'),
 ('野菜ジュース200ml','drink',70,'veg_juice:200'),
 ('バナナ1本','fruit',35,'banana:100'),
 ('カットサラダ1袋','vegetable',120,'cabbage:80,lettuce:30,carrot:10'),
 ('ミニトマト1パック（1/2）','vegetable',150,'tomato:100'),
 ('冷凍ブロッコリー100g','vegetable',60,'broccoli:100'),
 ('冷凍枝豆100g','vegetable',80,'edamame:100'),
 ('冷凍唐揚げ（5個）','protein',180,'karaage:125'),
 ('冷凍餃子（6個）','side',120,'gyoza:150'),
 ('冷凍チャーハン（1/2袋）','meal',200,'fried_rice:225'),
 ('冷凍うどん（かけ）','meal',60,'udon:200,udon_soup:300'),
 ('カップ麺（醤油）','meal',150,'ramen:150,ramen_soup:300'),
 ('カップ麺（シーフード）','meal',150,'ramen:150,ramen_soup:300,cream:5'),
 ('パックご飯200g','rice',140,'rice:200'),
 ('食パン（6枚切1枚）','main',35,'bread:60'),
 ('ロールパン2個','main',70,'bun:60'),
 ('オートミール30g','rice',35,'oats:30'),
 ('素焼きミックスナッツ25g','snack',90,'nuts:25'),
 ('プロテインバー','snack',150,'protein_bar:40'),
 ('インスタント味噌汁','soup',30,'miso_soup:160,wakame:3,tofu_soft:5'),
])

# ---------------------------------------------------------------- ヤオコー（惣菜・弁当中心）
add('ヤオコー', [
 ('手作りおにぎり 鮭','rice',150,'rice:120,salmon_salt:15,nori:2'),
 ('手作りおにぎり 梅','rice',130,'rice:120,umeboshi:6,nori:2'),
 ('手作りおにぎり 昆布','rice',130,'rice:120,kombu_tsukudani:10,nori:2'),
 ('手作りおにぎり ツナマヨ','rice',140,'rice:115,tuna_mayo:25,nori:2'),
 ('手作りおにぎり 明太子','rice',160,'rice:120,mentaiko:15,nori:2'),
 ('赤飯おにぎり','rice',150,'sekihan:130'),
 ('いなり寿司（3個）','rice',250,'inari:150'),
 ('おはぎ つぶあん（1個）','sweet',130,'mochigome:60,anko:50'),
 ('おはぎ きなこ（1個）','sweet',130,'mochigome:60,anko:35,soy_milk:5'),
 ('のり弁当','meal',450,'rice:250,fish_fry:50,chikuwa:30,kinpira:20,nori:3,sauce_sweet:10'),
 ('唐揚げ弁当','meal',500,'rice:250,karaage:120,cabbage:20,pickles:5'),
 ('幕の内弁当','meal',600,'rice:220,salmon_salt:40,tamagoyaki:30,karaage:40,nimono:50,pickles:5'),
 ('鶏そぼろ弁当','meal',450,'rice:250,soboro:60,egg:30,spinach:20'),
 ('生姜焼き弁当','meal',550,'rice:250,shogayaki:120,cabbage:30'),
 ('ハンバーグ弁当','meal',550,'rice:230,hamburg:120,potato_salad:30,sauce_sweet:15'),
 ('焼き鮭弁当','meal',550,'rice:230,salmon_salt:70,tamagoyaki:30,nimono:40'),
 ('かつ丼','meal',600,'rice:270,katsu_topping:200'),
 ('親子丼','meal',500,'rice:270,oyako_topping:200'),
 ('ちらし寿司','meal',600,'sushi_rice:250,chirashi_topping:80,tamagoyaki:20,shrimp:15'),
 ('にぎり寿司 10貫','meal',900,'sushi_rice:200,tuna_sashimi:40,salmon_sashimi:30,shrimp:15,squid:15,tamagoyaki:20'),
 ('巻き寿司（太巻 1/2本）','meal',350,'sushi_rice:180,tamagoyaki:30,kanikama:15,cucumber:10,nori:3'),
 ('五目ご飯','rice',300,'gomoku:250'),
 ('焼きそば（惣菜）','meal',350,'yakisoba_cooked:330'),
 ('冷やし中華','meal',500,'ramen:200,ham:15,egg:20,cucumber:20,udon_soup:60'),
 ('ざるそば','meal',380,'soba:220,udon_soup:60,negi:5'),
 ('ミートソースパスタ（惣菜）','meal',450,'pasta:220,meat_sauce:130'),
 ('焼き鳥 もも塩（2本）','protein',220,'yakitori_salt:80'),
 ('焼き鳥 たれ（2本）','protein',220,'yakitori_tare:80'),
 ('若鶏の唐揚げ（100g）','protein',250,'karaage:100'),
 ('コロッケ（1個）','side',100,'croquette:80'),
 ('メンチカツ（1個）','side',150,'menchi:100'),
 ('ロースとんかつ（1枚）','protein',400,'tonkatsu:130'),
 ('えび天ぷら（2本）','side',300,'shrimp_tempura:70'),
 ('焼売（6個）','side',300,'shumai:120'),
 ('春巻（2本）','side',250,'harumaki:100'),
 ('ポテトサラダ（100g）','vegetable',180,'potato_salad:100'),
 ('マカロニサラダ（100g）','vegetable',180,'macaroni_salad:100'),
 ('ひじき煮（100g）','vegetable',200,'hijiki_ni:100'),
 ('きんぴらごぼう（100g）','vegetable',200,'kinpira:100'),
 ('筑前煮（150g）','vegetable',350,'nimono:150'),
 ('ほうれん草の胡麻和え（80g）','vegetable',200,'goma_ae:80'),
 ('海藻サラダ','vegetable',250,'wakame:40,lettuce:40,cucumber:20,nonoil_dressing:15'),
 ('グリーンサラダ','vegetable',250,'lettuce:60,cucumber:30,tomato:30,cabbage:30,dressing:15'),
 ('豚汁（カップ）','soup',250,'tonjiru:250,pork_belly:15,daikon:30'),
 ('鮭の塩焼き（1切）','protein',300,'salmon_salt:80'),
 ('サバの味噌煮（1切）','protein',350,'saba_miso:120'),
 ('刺身盛り合わせ（1人前）','protein',600,'tuna_sashimi:50,salmon_sashimi:40,squid:20,daikon:20'),
 ('カットフルーツ','fruit',350,'fruit_mix:150'),
])

# ---------------------------------------------------------------- コンビニ
def konbini(store, extra_hot):
    rows = [
     ('おにぎり 鮭','rice',190,'rice:105,salmon_salt:12,nori:2'),
     ('おにぎり 紅しゃけ（直巻）','rice',200,'rice:105,salmon_salt:14,nori:2'),
     ('おにぎり ツナマヨネーズ','rice',160,'rice:100,tuna_mayo:22,nori:2'),
     ('おにぎり 梅','rice',150,'rice:105,umeboshi:5,nori:2'),
     ('おにぎり 昆布','rice',150,'rice:105,kombu_tsukudani:10,nori:2'),
     ('おにぎり 辛子明太子','rice',190,'rice:105,mentaiko:12,nori:2'),
     ('おにぎり 焼たらこ','rice',190,'rice:105,mentaiko:12,nori:2'),
     ('おにぎり 和風ツナ','rice',170,'rice:105,tuna_can:15,sauce_sweet:5,nori:2'),
     ('赤飯おこわおにぎり','rice',190,'sekihan:120'),
     ('炒飯おにぎり','rice',190,'fried_rice:120'),
     ('いなり寿司（2個）','rice',220,'inari:110'),
     ('手巻 サーモン','rice',240,'sushi_rice:100,salmon_sashimi:20,nori:3'),
     ('幕の内弁当','meal',600,'rice:220,salmon_salt:35,karaage:40,tamagoyaki:25,nimono:40,pickles:5'),
     ('唐揚げ弁当','meal',580,'rice:250,karaage:130,cabbage:15'),
     ('のり弁当','meal',520,'rice:250,fish_fry:50,chikuwa:30,kinpira:20,nori:3,sauce_sweet:10'),
     ('チキン南蛮弁当','meal',650,'rice:240,chicken_fried:120,egg_salad:30,sauce_sweet:15,cabbage:20'),
     ('牛カルビ弁当','meal',650,'rice:250,yakiniku:120,negi:5'),
     ('ハンバーグ弁当','meal',620,'rice:230,hamburg:130,sauce_sweet:15,potato_salad:20'),
     ('鶏そぼろ弁当','meal',520,'rice:250,soboro:60,egg:35,spinach:15'),
     ('カツ丼','meal',650,'rice:260,katsu_topping:200'),
     ('親子丼','meal',580,'rice:260,oyako_topping:200'),
     ('ビーフカレー','meal',600,'rice:250,curry_sauce:220,beef_belly:20'),
     ('ナポリタン','meal',500,'napolitan:330'),
     ('ミートソーススパゲッティ','meal',530,'pasta:230,meat_sauce:150'),
     ('ソース焼きそば','meal',480,'yakisoba_cooked:330'),
     ('ざるそば','meal',450,'soba:220,udon_soup:60,negi:5,nori:1'),
     ('冷やし中華','meal',550,'ramen:200,ham:15,egg:20,cucumber:20,udon_soup:60'),
     ('醤油ラーメン（レンジ麺）','meal',580,'ramen:200,ramen_soup:350,pork_belly:20,negi:5'),
     ('きつねうどん','meal',480,'udon:220,udon_soup:330,aburaage:20,negi:5'),
     ('ミックスサンド','main',330,'bread:70,egg_salad:30,ham:15,lettuce:10,cheese:8'),
     ('たまごサンド','main',300,'bread:70,egg_salad:55'),
     ('ハムレタスサンド','main',300,'bread:70,ham:25,lettuce:15,mayo:6'),
     ('ツナサンド','main',300,'bread:70,tuna_mayo:40'),
     ('カツサンド','main',420,'bread:80,tonkatsu:70,sauce_sweet:15'),
     ('ブリトー ハム＆チーズ','main',260,'tortilla:80,ham:20,cheese:25,white_sauce:20'),
     ('メロンパン','sweet',160,'sweet_bun:110,cookie:10'),
     ('あんぱん','sweet',150,'sweet_bun:70,anko:40'),
     ('ロールパン（4個入り／2個分）','main',100,'bun:60'),
     ('ブランパン（2個）','main',150,'bread:70'),
     ('サラダチキン プレーン','protein',260,'chicken_breast:115'),
     ('サラダチキン スモーク','protein',260,'chicken_breast:115,sauce_sweet:3'),
     ('サラダチキンバー','protein',170,'chicken_breast:60'),
     ('ゆでたまご（1個）','protein',90,'egg:55,umeboshi:0.5'),
     ('半熟煮たまご（1個）','protein',110,'egg:55,sauce_sweet:4'),
     ('ほっけの塩焼き','protein',450,'saba_salt:100'),
     ('さばの塩焼き','protein',350,'saba_salt:90'),
     ('冷奴','protein',150,'tofu_soft:150,ponzu:8,negi:3'),
     ('納豆巻','rice',160,'sushi_rice:90,natto:25,nori:3'),
     ('グリーンサラダ','vegetable',250,'lettuce:50,cabbage:30,cucumber:20,tomato:20'),
     ('ごぼうサラダ','vegetable',220,'gobou:50,carrot:15,mayo:12'),
     ('ポテトサラダ','vegetable',220,'potato_salad:110'),
     ('パスタサラダ','vegetable',360,'pasta:80,lettuce:30,ham:10,dressing:15'),
     ('春雨サラダ','vegetable',230,'harusame_salad:120'),
     ('蒸し鶏とブロッコリーのサラダ','vegetable',380,'chicken_breast:50,broccoli:60,lettuce:30,dressing:15'),
     ('ほうれん草胡麻和え','vegetable',200,'goma_ae:80'),
     ('ひじき煮','vegetable',200,'hijiki_ni:80'),
     ('具だくさん豚汁','soup',350,'tonjiru:250,pork_belly:15,daikon:30,carrot:15'),
     ('カップみそ汁','soup',150,'miso_soup:160,wakame:3,tofu_soft:5'),
     ('ミネストローネ（カップ）','soup',300,'consomme:220,tomato:60,veg_mix:50'),
     ('おでん 大根','vegetable',110,'daikon:100,udon_soup:40'),
     ('おでん たまご','protein',110,'egg:55,udon_soup:40'),
     ('おでん 厚揚げ','protein',130,'aburaage:30,tofu_firm:50,udon_soup:40'),
     ('枝豆（小袋）','vegetable',220,'edamame:80'),
     ('カットフルーツ','fruit',300,'fruit_mix:120'),
     ('バナナ（1本）','fruit',130,'banana:100'),
     ('ヨーグルト 無糖','protein',140,'yogurt_plain:150'),
     ('ギリシャヨーグルト','protein',200,'greek_yogurt:100'),
     ('飲むヨーグルト','drink',160,'yogurt_sweet:200'),
     ('牛乳 200ml','drink',110,'milk:206'),
     ('プロテイン飲料','drink',220,'protein_drink:240'),
     ('無調整豆乳 200ml','drink',110,'soy_milk:200'),
     ('野菜ジュース 200ml','drink',110,'veg_juice:200'),
     ('緑茶 600ml','drink',160,'tea:600'),
     ('ブラックコーヒー（ホット R）','drink',120,'coffee:150'),
     ('カフェラテ（ホット R）','drink',200,'latte:200'),
     ('スポーツドリンク 500ml','drink',170,'sports_drink:500'),
     ('コーラ 500ml','drink',180,'cola:500'),
     ('素焼きナッツ（小袋）','snack',200,'nuts:30'),
     ('プロテインバー','snack',170,'protein_bar:40'),
     ('ポテトチップス うすしお','snack',170,'chips:60'),
     ('おせんべい（小袋）','snack',150,'senbei:40'),
     ('チョコレート（板）','sweet',180,'chocolate:50'),
     ('シュークリーム','sweet',160,'custard:70,cream:15,sponge:20'),
     ('プリン','sweet',180,'pudding:110'),
     ('ロールケーキ','sweet',250,'sponge:40,cream:30'),
     ('どら焼き','sweet',150,'dorayaki:80'),
     ('アイス（バニラ・カップ）','sweet',180,'ice:100'),
     ('ゼリー（フルーツ）','sweet',200,'jelly:150,fruit_mix:40'),
    ]
    return rows + extra_hot

add('セブン‐イレブン', konbini('セブン‐イレブン', [
 ('揚げ鶏','protein',220,'chicken_fried:85'),
 ('ななチキ','protein',220,'chicken_fried:90'),
 ('からあげ棒','protein',170,'karaage:70'),
 ('アメリカンドッグ','side',160,'sausage:30,sweet_bun:60'),
 ('ハッシュポテト','side',140,'hash_brown:55'),
]))
add('ファミリーマート', konbini('ファミリーマート', [
 ('ファミチキ','protein',230,'chicken_fried:90'),
 ('スパイシーチキン','protein',230,'chicken_fried:90'),
 ('クリスピーチキン','protein',230,'chicken_fried:95'),
 ('焼き鳥 もも塩','protein',150,'yakitori_salt:40'),
 ('アメリカンドッグ','side',160,'sausage:30,sweet_bun:60'),
 ('ハッシュポテト','side',140,'hash_brown:55'),
]))
add('ローソン', konbini('ローソン', [
 ('からあげクン レギュラー','protein',260,'karaage:85'),
 ('Lチキ レギュラー','protein',230,'chicken_fried:90'),
 ('ブランパン（2個入）','main',160,'bread:60'),
 ('焼き鳥 もも塩','protein',150,'yakitori_salt:40'),
 ('アメリカンドッグ','side',160,'sausage:30,sweet_bun:60'),
]))

# ---------------------------------------------------------------- マクドナルド（公式値のない追加分）
add('マクドナルド', [
 ('チキンフィレオ','main',420,'bun:75,chicken_fried:100,lettuce:10,mayo:10'),
 ('チキンクリスプ','main',200,'bun:65,chicken_fried:80,lettuce:10,mayo:8'),
 ('サムライマック 炙り醤油風 ダブル肉厚ビーフ','main',600,'bun:80,beef_patty:160,onion:15,lettuce:10,teriyaki_sauce:20'),
 ('ダブルチーズバーガー（追加検証前の想定）','main',480,'bun:60,beef_patty:90,cheese:34,onion:5,pickles:5'),
 ('マックフライポテト S','side',200,'fries:74'),
 ('マックフライポテト M','side',330,'fries:135'),
 ('マックフライポテト L','side',380,'fries:170'),
 ('チキンマックナゲット 5ピース','protein',260,'nugget:92'),
 ('チキンマックナゲット 15ピース','protein',590,'nugget:276'),
 ('サイドサラダ','vegetable',290,'lettuce:40,cabbage:15,carrot:5,tomato:15'),
 ('えだまめコーン','vegetable',190,'edamame:30,corn:30'),
 ('ハッシュポテト','side',160,'hash_brown:55','breakfast'),
 ('ホットケーキ（3枚）','main',380,'sponge:160,sauce_sweet:30','breakfast'),
 ('ソーセージエッグマフィン','main',350,'muffin:60,sausage:50,egg:50,cheese:12','breakfast'),
 ('マックシェイク バニラ S','sweet',150,'shake:200'),
 ('ソフトツイスト','sweet',180,'ice:100'),
 ('ホットアップルパイ','sweet',180,'croissant:40,apple:40,sauce_sweet:10'),
 ('プレミアムローストコーヒー S','drink',120,'coffee:200'),
 ('カフェラテ S','drink',200,'latte:240'),
 ('コカ・コーラ S','drink',150,'cola:250'),
 ('コカ・コーラ M','drink',250,'cola:350'),
 ('オレンジジュース S','drink',150,'orange_juice:250'),
 ('爽健美茶 S','drink',150,'tea:250'),
 ('ミルク','drink',130,'milk:206'),
])

# ---------------------------------------------------------------- 松屋
add('松屋', [
 ('牛めし 大盛','meal',600,'rice:350,gyudon_topping:110,miso_soup:150'),
 ('牛めし 特盛','meal',730,'rice:350,gyudon_topping:170,miso_soup:150'),
 ('ネギたっぷり旨辛ネギたま牛めし 並盛','meal',590,'rice:260,gyudon_topping:85,negi:30,egg:50,miso_soup:150'),
 ('キムチ牛めし 並盛','meal',590,'rice:260,gyudon_topping:85,kimchi:40,miso_soup:150'),
 ('牛焼肉定食','meal',750,'rice:260,yakiniku:130,cabbage:50,miso_soup:150'),
 ('豚生姜焼定食','meal',750,'rice:260,shogayaki:130,cabbage:50,miso_soup:150'),
 ('カルビ焼肉定食','meal',850,'rice:260,yakiniku:150,cabbage:50,miso_soup:150'),
 ('ハンバーグ定食','meal',800,'rice:260,hamburg:150,cabbage:40,sauce_sweet:15,miso_soup:150'),
 ('鶏の甘辛定食','meal',750,'rice:260,karaage:130,sauce_sweet:15,cabbage:40,miso_soup:150'),
 ('オリジナルカレー 並盛','meal',530,'rice:260,curry_sauce:220'),
 ('ごろごろチキンカレー','meal',790,'rice:260,curry_sauce:220,chicken_thigh:80'),
 ('ソーセージエッグ定食','meal',480,'rice:200,sausage:40,egg:50,cabbage:20,miso_soup:150','breakfast'),
 ('焼鮭定食','meal',600,'rice:200,salmon_salt:60,natto:0,miso_soup:150,nori:2','breakfast'),
 ('納豆定食（朝）','meal',420,'rice:200,natto:45,nori:2,miso_soup:150','breakfast'),
 ('生野菜','vegetable',150,'cabbage:60,lettuce:15,carrot:5,dressing:10'),
 ('生玉子','protein',90,'egg:50'),
 ('半熟玉子','protein',100,'egg:50,sauce_sweet:3'),
 ('冷奴','protein',130,'tofu_soft:100,ponzu:5'),
 ('キムチ','vegetable',130,'kimchi:40'),
 ('豚汁','soup',190,'tonjiru:220,pork_belly:15,daikon:20'),
 ('みそ汁','soup',80,'miso_soup:150'),
])

# ---------------------------------------------------------------- すき家
add('すき家', [
 ('牛丼 特盛','meal',900,'rice:330,gyudon_topping:170'),
 ('牛丼 メガ','meal',1000,'rice:330,gyudon_topping:240'),
 ('とろ～り3種のチーズ牛丼 並盛','meal',650,'rice:250,gyudon_topping:85,cheese:35,sauce_sweet:5'),
 ('ねぎ玉牛丼 並盛','meal',620,'rice:250,gyudon_topping:85,negi:30,egg:50'),
 ('おろしポン酢牛丼 並盛','meal',620,'rice:250,gyudon_topping:85,daikon:60,ponzu:15'),
 ('キムチ牛丼 並盛','meal',620,'rice:250,gyudon_topping:85,kimchi:40'),
 ('牛あいがけカレー 並盛','meal',720,'rice:250,curry_sauce:160,gyudon_topping:60'),
 ('すき家カレー 並盛','meal',540,'rice:250,curry_sauce:200'),
 ('うな牛','meal',1300,'rice:250,gyudon_topping:60,saba_miso:60'),
 ('牛皿定食','meal',700,'rice:250,gyudon_topping:110,miso_soup:150,pickles:15'),
 ('鮭朝食','meal',590,'rice:200,salmon_salt:60,egg:50,nori:2,miso_soup:150','breakfast'),
 ('納豆朝食','meal',420,'rice:200,natto:45,egg:50,nori:2,miso_soup:150','breakfast'),
 ('たまかけ朝食','meal',350,'rice:200,egg:50,nori:2,miso_soup:150','breakfast'),
 ('サラダ','vegetable',150,'cabbage:50,lettuce:15,carrot:5,dressing:10'),
 ('たまご','protein',90,'egg:50'),
 ('おんたま','protein',100,'onsen_egg:50,sauce_sweet:3'),
 ('おしんこ','vegetable',130,'pickles:30'),
 ('豚汁','soup',220,'tonjiru:220,pork_belly:15,daikon:20'),
 ('みそ汁','soup',90,'miso_soup:150'),
 ('とん汁おしんこセット','soup',290,'tonjiru:220,pork_belly:15,pickles:30'),
])

# ---------------------------------------------------------------- existing official items: estimated fiber / price
FIBER_EST = {  # by id: estimated fiber (g) from contents
 'p001':1.4,'p002':1.4,'p003':1.4,'p004':1.9,'p005':1.6,'p006':1.4,'p007':1.5,'p008':2.3,'p009':1.6,'p010':1.7,
 'p011':1.9,'p012':1.0,'p013':1.0,'p014':1.0,'p015':1.3,'p016':1.7,'p017':1.3,'p018':1.8,'p019':1.6,'p020':2.3,
 'p022':1.6,'p023':1.7,
}
PRICE_EST = {'p023':172}
REMOVE_ASSUMED_DUP = {'ダブルチーズバーガー（追加検証前の想定）'}  # official one already exists

def main():
    seed_src = (ROOT/'data.js').read_text(encoding='utf-8')
    m = re.search(r'window\.SEED_FOODS\s*=\s*(\[.*\]);', seed_src, re.S)
    old = json.loads(m.group(1))
    out = []
    for f in old:
        if not f['id'].startswith('p') or int(f['id'][1:]) > 51:
            continue  # rebuilt below
        f = dict(f)
        est = list(f.get('est', []))
        if f['store'] == '自炊・スーパー':
            continue  # the old mixed list is replaced by the 自炊 list above
            f['store'] = '自炊'
            f['quality'] = 'estimate'
            f['note'] = '食材の成分値から算出した想定値。価格は1食あたりの食材費の想定。'
        if f.get('fiber') is None and f['id'] in FIBER_EST:
            f['fiber'] = FIBER_EST[f['id']]; est.append('fiber')
        est = list(dict.fromkeys(est))
        if f.get('price') is None and f['id'] in PRICE_EST:
            f['price'] = PRICE_EST[f['id']]; est.append('price')
        if est:
            f['est'] = est
        out.append(f)
    # 自炊 rows superseded by the new 自炊 list (same name) are dropped from old to avoid duplicates
    new_names = {(s, n) for (s, n, *_rest) in ITEMS}
    out = [f for f in out if (f['store'], f['name']) not in new_names]
    official_names = {(f['store'], f['name']) for f in out}
    n = 100
    for row in ITEMS:
        store, name, kind, price, spec = row[:5]
        time = row[5] if len(row) > 5 else 'any'
        if name in REMOVE_ASSUMED_DUP or (store, name) in official_names:
            continue
        if 'おにぎり' in name and store != '自炊':
            spec = re.sub(r'(^|,)rice:', r'\1onigiri_rice:', spec)
        if 'サラダチキン' in name:
            spec = spec.replace('chicken_breast:', 'salad_chicken:')
        nut = calc(parse(spec))
        n += 1
        out.append({
            'id': f'e{n:03d}', 'store': store, 'name': name, **nut, 'price': price,
            'source': MEXT, 'quality': 'estimate',
            'note': '内容物（' + '・'.join(dict.fromkeys(JA[k] for k, g in parse(spec) if g > 0)) + '）から算出した想定値。価格も目安です。' if store != '自炊'
                    else '食材の成分値から算出した想定値。価格は1食あたりの食材費の想定。',
            'time': time, 'kind': kind, 'price_type': 'approx', 'est': ['nutrition', 'price'],
            'contents': [[k, g] for k, g in parse(spec)],
        })
    # keep official kinds sensible
    for f in out:
        if f['quality'] == 'official':
            if f['store'] in ('松屋', 'すき家'): f['kind'] = 'meal'
            elif f['store'] == 'マクドナルド': f['kind'] = 'main'
            elif f['store'] == 'ローソン': f['kind'] = 'protein'
            elif 'ランチ' in f['name']: f['kind'] = 'meal'
            elif 'ロール' in f['name']: f['kind'] = 'main'
            elif 'むすび' in f['name'] or 'おむすび' in f['name'] or '直巻' in f['name']: f['kind'] = 'rice'
    for f in out:
        f.pop('contents', None)
    header = '/* NutriPath catalog. Generated by tools/build_catalog.py — official values are from chain pages (see source),\n   items with quality "estimate" are 想定 values derived from their contents. */\n'
    (ROOT/'data.js').write_text(header + 'window.SEED_FOODS = ' + json.dumps(out, ensure_ascii=False) + ';\n', encoding='utf-8')
    (ROOT/'catalog.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    from collections import Counter
    c = Counter(f['store'] for f in out)
    print(len(out), dict(c))

if __name__ == '__main__':
    main()
