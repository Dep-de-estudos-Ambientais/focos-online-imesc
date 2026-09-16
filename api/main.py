from __future__ import annotations
import os
from datetime import date
from typing import Literal, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from db.connection import get_connection
from api.routes_cartograficas import router as cartografia_router
from api.tiles_cache import router as raster_router

AMBIENTE=Literal['brasil','maranhao']; MODO=Literal['todos','referencia']
app=FastAPI(title='API Focos de Calor',description='DEA/IMESC',version='0.4.3')
app.include_router(cartografia_router); app.include_router(raster_router)
app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_credentials=False,allow_methods=['GET'],allow_headers=['*'])

def ref(): return os.getenv('SATELITE_REFERENCIA','AQUA_M-T').strip() or 'AQUA_M-T'
def aand(w,c): return f'{w} AND {c}' if w else f'WHERE {c}'
def wh(ambiente='brasil',modo='todos',municipio=None,risco=None,evento=None,em_uc=None,em_ti=None,data_inicio=None,data_fim=None,padrao24=True):
    f=[]; p=[]
    if ambiente=='maranhao': f.append('estado_id=21')
    if modo=='referencia': f.append('UPPER(satelite)=UPPER(%s)'); p.append(ref())
    if municipio: f.append('UPPER(municipio)=UPPER(%s)'); p.append(municipio)
    if risco: f.append('UPPER(classe_risco)=UPPER(%s)'); p.append(risco)
    if evento is not None: f.append('dentro_evento_fogo=%s'); p.append(evento)
    if em_uc is not None: f.append('em_unidade_conservacao=%s'); p.append(em_uc)
    if em_ti is not None: f.append('em_terra_indigena=%s'); p.append(em_ti)
    if data_inicio: f.append('data_hora_utc >= %s'); p.append(data_inicio)
    if data_fim: f.append("data_hora_utc < (%s::date + interval '1 day')"); p.append(data_fim)
    if padrao24 and not data_inicio and not data_fim: f.append("data_hora_utc >= NOW()-INTERVAL '24 hours'")
    return ('WHERE '+' AND '.join(f) if f else ''),p

def one(sql,p=None):
    with get_connection() as c:
        with c.cursor(row_factory=dict_row) as q: q.execute(sql,p or []); return q.fetchone()
def all(sql,p=None):
    with get_connection() as c:
        with c.cursor(row_factory=dict_row) as q: q.execute(sql,p or []); return q.fetchall()

@app.get('/')
def inicio(): return {'sistema':'Monitoramento de Focos de Calor','versao':'0.4.3'}
@app.get('/api/config')
def config(): return {'versao_api':'0.4.3','satelite_referencia':ref(),'ambientes':[{'id':'brasil','nome':'Brasil'},{'id':'maranhao','nome':'Maranhão'}]}
@app.get('/api/status')
def status(): return {'status':'online',**one('SELECT COUNT(*) total_focos,MAX(data_hora_utc) ultimo_foco,MAX(atualizado_em) ultima_atualizacao FROM focos')}
@app.get('/api/municipios')
def municipios(ambiente:AMBIENTE='brasil'):
    w,p=wh(ambiente=ambiente,padrao24=False); w=aand(w,'municipio IS NOT NULL')
    return all(f'SELECT estado,municipio,municipio_id,COUNT(*) total_focos FROM focos {w} GROUP BY estado,municipio,municipio_id ORDER BY estado,municipio',p)
@app.get('/api/dashboard')
def dashboard(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None):
    w,p=wh(ambiente,modo,municipio=municipio,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim)
    return {'ambiente':ambiente,'modo':modo,**one(f'''SELECT COUNT(*) total_focos,COUNT(*) FILTER(WHERE classe_risco IN('Alto','Crítico')) alto_critico,
    ROUND(100.0*COUNT(*) FILTER(WHERE classe_risco IN('Alto','Crítico'))/NULLIF(COUNT(*) FILTER(WHERE classe_risco IS NOT NULL AND classe_risco<>'Sem dado'),0),2) alto_critico_pct,
    COUNT(*) FILTER(WHERE prf_mw>=200) prf_alta_mais,COUNT(*) FILTER(WHERE dentro_evento_fogo IS TRUE) focos_em_eventos,
    COUNT(DISTINCT municipio) municipios_com_focos FROM focos {w}''',p)}
@app.get('/api/destaques')
def destaques(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None):
    w,p=wh(ambiente,modo,municipio=municipio,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); d=dashboard(ambiente,modo,municipio,em_uc,em_ti,data_inicio,data_fim)
    topm=one(f"SELECT estado,municipio,COUNT(*) total FROM focos {aand(w,'municipio IS NOT NULL')} GROUP BY estado,municipio ORDER BY total DESC LIMIT 1",p)
    topb=one(f"SELECT bioma,COUNT(*) total FROM focos {aand(w,'bioma IS NOT NULL')} GROUP BY bioma ORDER BY total DESC LIMIT 1",p)
    topu=one(f"SELECT uso_solo,COUNT(*) total FROM focos {aand(w,'uso_solo IS NOT NULL')} GROUP BY uso_solo ORDER BY total DESC LIMIT 1",p)
    tops=one(f"SELECT satelite,COUNT(*) total FROM focos {aand(w,'satelite IS NOT NULL')} GROUP BY satelite ORDER BY total DESC LIMIT 1",p)
    extra={}
    if ambiente=='maranhao': extra=one(f'''SELECT COUNT(*) FILTER(WHERE em_unidade_conservacao IS TRUE) focos_em_unidade_conservacao,COUNT(*) FILTER(WHERE em_terra_indigena IS TRUE) focos_em_terra_indigena,COUNT(*) FILTER(WHERE rodovia_proxima_1km IS TRUE) focos_proximos_rodovia_1km,COUNT(*) FILTER(WHERE linha_energia_proxima_1km IS TRUE) focos_proximos_energia_1km FROM focos {w}''',p)
    return {**d,**extra,'municipio_lider':topm,'bioma_predominante':topb,'uso_solo_predominante':topu,'satelite_predominante':tops}
@app.get('/api/mapa')
def mapa(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,risco:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=3000):
    w,p=wh(ambiente,modo,municipio=municipio,risco=risco,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'geom IS NOT NULL'); p.append(limite)
    rows=all(f'''SELECT id_foco,data_hora_utc,data_hora_local,satelite,estado,municipio,bioma,classe_risco,COALESCE(risco_fogo_enriquecido,risco_fogo_original) risco_fogo_exibicao,prf_mw,classe_prf,uso_solo,descricao_uso_solo_500m,classe_relevo,descricao_terreno_500m,dentro_evento_fogo,em_terra_indigena,terra_indigena_nome,em_unidade_conservacao,unidade_conservacao_nome,rodovia_mais_proxima,rodovia_jurisdicao,distancia_rodovia_m,ST_AsGeoJSON(geom)::json geometry FROM focos {w} ORDER BY data_hora_utc DESC LIMIT %s''',p)
    fs=[]
    for r in rows: g=r.pop('geometry'); fs.append({'type':'Feature','id':r['id_foco'],'geometry':g,'properties':r})
    return {'type':'FeatureCollection','quantidade':len(fs),'features':fs}
@app.get('/api/kernel')
def kernel(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=10000):
    w,p=wh(ambiente,modo,municipio=municipio,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); p.append(limite)
    return {'pontos':all(f'SELECT latitude,longitude,1 peso FROM focos {w} ORDER BY data_hora_utc DESC LIMIT %s',p)}
@app.get('/api/ranking/regioes')
def regioes(modo:MODO='todos',data_inicio:Optional[date]=None,data_fim:Optional[date]=None):
    w,p=wh('brasil',modo,data_inicio=data_inicio,data_fim=data_fim)
    return all(f'''SELECT CASE WHEN estado_id IN(11,12,13,14,15,16,17) THEN 'Norte' WHEN estado_id IN(21,22,23,24,25,26,27,28,29) THEN 'Nordeste' WHEN estado_id IN(31,32,33,35) THEN 'Sudeste' WHEN estado_id IN(41,42,43) THEN 'Sul' WHEN estado_id IN(50,51,52,53) THEN 'Centro-Oeste' ELSE 'Sem região' END regiao,COUNT(*) total_focos FROM focos {w} GROUP BY 1 ORDER BY total_focos DESC''',p)
@app.get('/api/ranking/estados')
def estados(modo:MODO='todos',data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=10):
    w,p=wh('brasil',modo,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'estado IS NOT NULL'); p.append(limite)
    return all(f'SELECT estado,COUNT(*) total_focos FROM focos {w} GROUP BY estado ORDER BY total_focos DESC LIMIT %s',p)
@app.get('/api/ranking/municipios')
def munrank(ambiente:AMBIENTE='brasil',modo:MODO='todos',em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=10):
    w,p=wh(ambiente,modo,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'municipio IS NOT NULL'); p.append(limite)
    return all(f'''SELECT estado,municipio,COUNT(*) total_focos,COUNT(*) FILTER(WHERE classe_risco IN('Alto','Crítico')) alto_critico,COUNT(*) FILTER(WHERE dentro_evento_fogo IS TRUE) focos_em_eventos FROM focos {w} GROUP BY estado,municipio ORDER BY total_focos DESC LIMIT %s''',p)
@app.get('/api/series/temporal')
def serie(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None):
    w,p=wh(ambiente,modo,municipio=municipio,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim)
    return all(f"SELECT date_trunc('hour',data_hora_utc) periodo,COUNT(*) total_focos,COUNT(*) FILTER(WHERE classe_risco IN('Alto','Crítico')) alto_critico FROM focos {w} GROUP BY 1 ORDER BY 1",p)
def dist(col,alias,ambiente,modo,municipio,em_uc,em_ti,data_inicio,data_fim):
    w,p=wh(ambiente,modo,municipio=municipio,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); return all(f"SELECT COALESCE({col},'Sem dado') {alias},COUNT(*) total FROM focos {w} GROUP BY 1 ORDER BY total DESC",p)
@app.get('/api/distribuicao/risco')
def dr(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None): return dist('classe_risco','classe',ambiente,modo,municipio,em_uc,em_ti,data_inicio,data_fim)
@app.get('/api/distribuicao/biomas')
def db(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None): return dist('bioma','bioma',ambiente,modo,municipio,em_uc,em_ti,data_inicio,data_fim)
@app.get('/api/distribuicao/uso-solo')
def du(ambiente:AMBIENTE='brasil',modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None): return dist('uso_solo','uso_solo',ambiente,modo,municipio,em_uc,em_ti,data_inicio,data_fim)
@app.get('/api/distribuicao/relevo')
def dre(modo:MODO='todos',municipio:Optional[str]=None,em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None): return dist('classe_relevo','classe_relevo','maranhao',modo,municipio,em_uc,em_ti,data_inicio,data_fim)
@app.get('/api/eventos')
def eventos(ambiente:AMBIENTE='brasil',modo:MODO='todos',em_uc:Optional[bool]=None,em_ti:Optional[bool]=None,data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=8):
    w,p=wh(ambiente,modo,evento=True,em_uc=em_uc,em_ti=em_ti,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'COALESCE(id_evento_fogo,id_evento_mais_proximo) IS NOT NULL'); p.append(limite)
    return all(f'''SELECT COALESCE(id_evento_fogo,id_evento_mais_proximo) id_evento,MAX(COALESCE(status_evento_fogo,status_evento_mais_proximo)) status_evento,MAX(area_evento_km2) area_evento_km2,COUNT(*) focos_presentes_na_base,MAX(max_prf_evento_mw) max_prf_evento_mw FROM focos {w} GROUP BY 1 ORDER BY focos_presentes_na_base DESC LIMIT %s''',p)
@app.get('/api/territorial/maranhao/ucs')
def ucs(modo:MODO='todos',data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=20):
    w,p=wh('maranhao',modo,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'em_unidade_conservacao IS TRUE AND unidade_conservacao_nome IS NOT NULL'); p.append(limite)
    return all(f'SELECT unidade_conservacao_nome nome,MAX(unidade_conservacao_categoria) categoria,COUNT(*) total_focos FROM focos {w} GROUP BY unidade_conservacao_nome ORDER BY total_focos DESC LIMIT %s',p)
@app.get('/api/territorial/maranhao/tis')
def tis(modo:MODO='todos',data_inicio:Optional[date]=None,data_fim:Optional[date]=None,limite:int=20):
    w,p=wh('maranhao',modo,data_inicio=data_inicio,data_fim=data_fim); w=aand(w,'em_terra_indigena IS TRUE AND terra_indigena_nome IS NOT NULL'); p.append(limite)
    return all(f'SELECT terra_indigena_nome nome,MAX(terra_indigena_etnia) etnia,COUNT(*) total_focos FROM focos {w} GROUP BY terra_indigena_nome ORDER BY total_focos DESC LIMIT %s',p)
@app.get('/api/focos/{id_foco}/ficha')
def ficha(id_foco:str):
    r=one('SELECT *,COALESCE(risco_fogo_enriquecido,risco_fogo_original) risco_fogo_exibicao FROM focos WHERE id_foco=%s',[id_foco])
    if not r: raise HTTPException(404,'Foco não encontrado')
    return {'localizacao':{'municipio':r['municipio'],'estado':r['estado'],'data_hora_local':r['data_hora_local'],'satelite':r['satelite']},'fogo':{'classe_risco':r['classe_risco'],'risco_fogo':r['risco_fogo_exibicao'],'prf_mw':r['prf_mw'],'classe_prf':r['classe_prf']},'uso_cobertura':{'uso_solo_ponto':r['uso_solo'],'descricao_500m':r['descricao_uso_solo_500m']},'relevo':{'classe_relevo':r['classe_relevo'],'descricao_500m':r['descricao_terreno_500m']},'territorialidades':{'unidade_conservacao':{'dentro':r['em_unidade_conservacao'],'nome':r['unidade_conservacao_nome']},'terra_indigena':{'dentro':r['em_terra_indigena'],'nome':r['terra_indigena_nome']},'rodovia':{'nome':r['rodovia_mais_proxima'],'distancia_m':r['distancia_rodovia_m']}}}
