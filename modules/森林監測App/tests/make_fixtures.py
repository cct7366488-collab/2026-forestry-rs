# 產生測試用 Shapefile（模擬台灣林業實務會拿到的各種檔）
#   執行：python make_fixtures.py     （需要 geopandas）
#   輸出：fixtures/（已 gitignore — 隨時可重生，不進 repo）
#
# 座標刻意取橫流溪一帶（TWD97 TM2 約 219800E / 2674000N ≒ 120.70°E, 24.17°N），
# 讓測試可以斷言「最終一定落在台灣中部」，而不是只比對數字有沒有變。

import os
import shutil
import zipfile

import geopandas as gpd
from shapely.geometry import Polygon, LineString

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

# 兩個假作業單元（專案邊界尺度）
poly_a = Polygon([(219800, 2674000), (220000, 2674000), (220000, 2674200), (219800, 2674200)])
poly_b = Polygon([(220100, 2674000), (220300, 2674000), (220300, 2674250), (220100, 2674250)])

attrs = {
    '承租人': ['陳○明', '林○華'],
    '林班': ['橫流溪 12 林班', '烏石坑 7 林班'],
    '假地號': ['1234-0001', '1234-0002'],
    '面積HA': [4.0, 5.0],
}

gdf_tm2 = gpd.GeoDataFrame(attrs, geometry=[poly_a, poly_b], crs='EPSG:3826')
gdf_wgs = gdf_tm2.to_crs('EPSG:4326')


def write(gdf, name, encoding, drop_cpg=False, drop_prj=False):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    gdf.to_file(os.path.join(d, f'{name}.shp'), driver='ESRI Shapefile', encoding=encoding)
    for drop, ext in ((drop_cpg, 'cpg'), (drop_prj, 'prj')):
        f = os.path.join(d, f'{name}.{ext}')
        if drop and os.path.exists(f):
            os.remove(f)
    print(f'  {name}: ' + ', '.join(sorted(os.listdir(d))))
    return d


print('產生測試 shapefile：')
# 案例 1：WGS84 + .prj + UTF-8 + .cpg（QGIS 標準輸出）
d1 = write(gdf_wgs, 'case1_wgs84_utf8', 'utf-8')
# 案例 2：TWD97 TM2 + .prj + Big5 且刻意刪掉 .cpg（台灣政府圖資常見）
d2 = write(gdf_tm2, 'case2_twd97_big5_nocpg', 'big5', drop_cpg=True)
# 案例 3：TWD97 但連 .prj 都沒有（靠座標範圍自動判斷）
d3 = write(gdf_tm2, 'case3_twd97_noprj', 'utf-8', drop_prj=True)
# 案例 4：線圖層（應被擋下並給明確訊息）
gdf_line = gpd.GeoDataFrame(
    {'名稱': ['界線']},
    geometry=[LineString([(219800, 2674000), (220000, 2674200)])],
    crs='EPSG:3826')
write(gdf_line, 'case4_line', 'utf-8')

# 案例 5/6：打包成 zip — 分別測 deflate 與 stored（未壓縮）兩種 entry
for src, zname, mode in [(d2, 'case5_zip_deflate.zip', zipfile.ZIP_DEFLATED),
                         (d1, 'case6_zip_stored.zip', zipfile.ZIP_STORED)]:
    zp = os.path.join(OUT, zname)
    with zipfile.ZipFile(zp, 'w', mode) as z:
        for f in sorted(os.listdir(src)):
            z.write(os.path.join(src, f), f'boundary/{f}')   # 刻意放子目錄，測路徑處理
    print(f'  {zname}: {os.path.getsize(zp)} bytes')

# 案例 7：樣區尺度 20×25 m（走 plot 那條路：local 座標換算 + VERTEX_MAX 檢查）
x0, y0 = 219900, 2674050
plot_poly = Polygon([(x0, y0), (x0 + 20, y0), (x0 + 20, y0 + 25), (x0, y0 + 25)])
write(gpd.GeoDataFrame({'樣區': ['P-001']}, geometry=[plot_poly], crs='EPSG:3826'),
      'case7_plot_20x25', 'utf-8')

print(f'\n輸出目錄：{OUT}')
