"""Converte raster categórico MapBiomas Maranhão em uma imagem WebP única.
Uso: python gerar_webp_mapbiomas.py mapbiomas_maranhao.tif docs/camadas/mapbiomas_2025_ma.webp
Requer rasterio, numpy, Pillow. A saída é uma visualização generalizada, não um raster analítico.
"""
import sys
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

PALETTE = {
 3:'#1f8d49',4:'#7dc975',5:'#04381d',6:'#026975',9:'#7a5900',11:'#519799',
 12:'#d6bc74',15:'#edde8e',19:'#c27ba0',21:'#ffefc3',23:'#ffa07a',24:'#d4271e',
 25:'#db4d4f',29:'#ffaa5f',30:'#9c0027',31:'#091077',32:'#fc8114',33:'#2532e4',
 36:'#f5b3c8',50:'#c1a0ff',91:'#888888'
}
SRC=Path(sys.argv[1]) if len(sys.argv)>1 else Path('mapbiomas_maranhao.tif')
OUT=Path(sys.argv[2]) if len(sys.argv)>2 else Path('docs/camadas/mapbiomas_2025_ma.webp')
WIDTH=2800
lut=np.zeros((256,4),dtype=np.uint8)
for cls,hexcolor in PALETTE.items():
 lut[cls]=[int(hexcolor[i:i+2],16) for i in (1,3,5)]+[255]
with rasterio.open(SRC) as ds:
 if ds.crs.to_epsg()!=4326: raise ValueError('Este script espera EPSG:4326')
 h=round(WIDTH*ds.height/ds.width)
 values=ds.read(1,out_shape=(h,WIDTH),resampling=Resampling.nearest)
 print('Dimensões da imagem:',WIDTH,'x',h)
 print('Limites geográficos [sul, oeste], [norte, leste]:',[[ds.bounds.bottom,ds.bounds.left],[ds.bounds.top,ds.bounds.right]])
 rgba=lut[values]
 image=Image.fromarray(rgba,'RGBA')
 OUT.parent.mkdir(parents=True,exist_ok=True)
 image.save(OUT,'WEBP',lossless=True,method=6)
 print('Arquivo:',OUT,'Tamanho MB:',round(OUT.stat().st_size/1024**2,2))
