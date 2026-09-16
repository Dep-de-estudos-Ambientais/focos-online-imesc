from __future__ import annotations
from typing import Literal
from fastapi import APIRouter
from psycopg.rows import dict_row
from db.connection import get_connection

router=APIRouter(tags=['Cartografia'])

def rows(sql,p=None):
    with get_connection() as c:
        with c.cursor(row_factory=dict_row) as q: q.execute(sql,p or []); return q.fetchall()

@router.get('/api/camadas/maranhao/{tipo}')
def camada(tipo:Literal['uc','ti','rodovia','energia','municipio']):
    data=rows("SELECT id,nome,propriedades,ST_AsGeoJSON(geom)::json geometry FROM camadas_maranhao WHERE tipo=%s ORDER BY id",[tipo])
    return {'type':'FeatureCollection','features':[{'type':'Feature','id':r['id'],'geometry':r['geometry'],'properties':{'nome':r['nome'],**(r['propriedades'] or {})}} for r in data]}

@router.get('/api/coropletico/maranhao/municipios')
def coropletico():
    data=rows("""WITH q AS(SELECT municipio_id,municipio,COUNT(*) total FROM focos WHERE estado_id=21 AND data_hora_utc>=NOW()-INTERVAL '24 hours' GROUP BY municipio_id,municipio)
    SELECT c.id,c.nome,c.propriedades,COALESCE(q.total,0) total_focos,ST_AsGeoJSON(c.geom)::json geometry
    FROM camadas_maranhao c LEFT JOIN q ON ((c.propriedades->>'municipio_id')~'^[0-9]+$' AND (c.propriedades->>'municipio_id')::bigint=q.municipio_id) OR UPPER(c.nome)=UPPER(q.municipio)
    WHERE c.tipo='municipio' ORDER BY total_focos DESC""")
    return {'type':'FeatureCollection','features':[{'type':'Feature','id':r['id'],'geometry':r['geometry'],'properties':{'nome':r['nome'],'total_focos':r['total_focos'],**(r['propriedades'] or {})}} for r in data]}

@router.get('/api/eventos/mapa')
def eventos_mapa(ambiente:Literal['brasil','maranhao']='brasil',grupo:Literal['ativos','observacao']='ativos'):
    fallback='Ativo' if grupo=='ativos' else 'Em observação'
    cond="EXISTS(SELECT 1 FROM focos f WHERE COALESCE(f.id_evento_fogo,f.id_evento_mais_proximo)=e.id_evento AND f.data_hora_utc>=NOW()-INTERVAL '24 hours'"
    if ambiente=='maranhao': cond += ' AND f.estado_id=21'
    cond += ')'
    data=rows(f"SELECT e.id_evento,e.status_evento,e.propriedades,ST_AsGeoJSON(e.geom)::json geometry FROM eventos_fogo e WHERE COALESCE(e.propriedades->>'_status_fallback','')=%s AND {cond}",[fallback])
    return {'type':'FeatureCollection','features':[{'type':'Feature','id':r['id_evento'],'geometry':r['geometry'],'properties':{'id_evento':r['id_evento'],'status_evento':r['status_evento'],**(r['propriedades'] or {})}} for r in data]}
