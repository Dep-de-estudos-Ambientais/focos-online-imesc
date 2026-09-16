from __future__ import annotations

import os
from datetime import date
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row

from db.connection import get_connection
from api.routes_cartograficas import router as cartografia_router


# ============================================================
# CONFIGURAÇÃO
# ============================================================

AMBIENTE = Literal["brasil", "maranhao"]
MODO = Literal["todos", "referencia"]

API_VERSION = "0.5.0"

app = FastAPI(
    title="API Focos de Calor",
    description="Monitoramento de Focos de Calor — DEA/IMESC",
    version=API_VERSION,
)


# ============================================================
# ROTAS COMPLEMENTARES
# ============================================================

app.include_router(cartografia_router)


# ============================================================
# CORS
# ============================================================

cors_env = os.getenv("CORS_ORIGINS", "*").strip()

if cors_env == "*":
    cors_origins = ["*"]
else:
    cors_origins = [
        origem.strip()
        for origem in cors_env.split(",")
        if origem.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

def ref():
    return os.getenv(
        "SATELITE_REFERENCIA",
        "AQUA_M-T",
    ).strip() or "AQUA_M-T"


def aand(where, condicao):
    return f"{where} AND {condicao}" if where else f"WHERE {condicao}"


def wh(
    ambiente="brasil",
    modo="todos",
    municipio=None,
    risco=None,
    evento=None,
    em_uc=None,
    em_ti=None,
    data_inicio=None,
    data_fim=None,
    padrao24=True,
):
    filtros = []
    parametros = []

    if ambiente == "maranhao":
        filtros.append("estado_id=21")

    if modo == "referencia":
        filtros.append("UPPER(satelite)=UPPER(%s)")
        parametros.append(ref())

    if municipio:
        filtros.append("UPPER(municipio)=UPPER(%s)")
        parametros.append(municipio)

    if risco:
        filtros.append("UPPER(classe_risco)=UPPER(%s)")
        parametros.append(risco)

    if evento is not None:
        filtros.append("dentro_evento_fogo=%s")
        parametros.append(evento)

    if em_uc is not None:
        filtros.append("em_unidade_conservacao=%s")
        parametros.append(em_uc)

    if em_ti is not None:
        filtros.append("em_terra_indigena=%s")
        parametros.append(em_ti)

    if data_inicio:
        filtros.append("data_hora_utc >= %s")
        parametros.append(data_inicio)

    if data_fim:
        filtros.append(
            "data_hora_utc < (%s::date + interval '1 day')"
        )
        parametros.append(data_fim)

    if padrao24 and not data_inicio and not data_fim:
        filtros.append(
            "data_hora_utc >= NOW()-INTERVAL '24 hours'"
        )

    where = (
        "WHERE " + " AND ".join(filtros)
        if filtros
        else ""
    )

    return where, parametros


def one(sql, parametros=None):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, parametros or [])
            return cur.fetchone()


def all_rows(sql, parametros=None):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, parametros or [])
            return cur.fetchall()


# ============================================================
# SISTEMA
# ============================================================

@app.get("/")
def inicio():
    return {
        "sistema": "Monitoramento de Focos de Calor",
        "instituicao": "IMESC",
        "versao": API_VERSION,
        "status": "online",
    }


@app.get("/api/config")
def config():
    return {
        "versao_api": API_VERSION,
        "satelite_referencia": ref(),
        "ambientes": [
            {
                "id": "brasil",
                "nome": "Brasil",
            },
            {
                "id": "maranhao",
                "nome": "Maranhão",
            },
        ],
    }


@app.get("/api/status")
def status():
    resultado = one(
        """
        SELECT
            COUNT(*) AS total_focos,
            MAX(data_hora_utc) AS ultimo_foco,
            MAX(atualizado_em) AS ultima_atualizacao
        FROM focos
        """
    )

    return {
        "status": "online",
        **resultado,
    }


# ============================================================
# MUNICÍPIOS
# ============================================================

@app.get("/api/municipios")
def municipios(
    ambiente: AMBIENTE = "brasil",
):
    where, parametros = wh(
        ambiente=ambiente,
        padrao24=False,
    )

    where = aand(
        where,
        "municipio IS NOT NULL",
    )

    return all_rows(
        f"""
        SELECT
            estado,
            municipio,
            municipio_id,
            COUNT(*) AS total_focos
        FROM focos
        {where}
        GROUP BY
            estado,
            municipio,
            municipio_id
        ORDER BY
            estado,
            municipio
        """,
        parametros,
    )


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/api/dashboard")
def dashboard(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    resultado = one(
        f"""
        SELECT
            COUNT(*) AS total_focos,

            COUNT(*) FILTER (
                WHERE classe_risco IN ('Alto','Crítico')
            ) AS alto_critico,

            ROUND(
                100.0 *
                COUNT(*) FILTER (
                    WHERE classe_risco IN ('Alto','Crítico')
                )
                /
                NULLIF(
                    COUNT(*) FILTER (
                        WHERE classe_risco IS NOT NULL
                        AND classe_risco <> 'Sem dado'
                    ),
                    0
                ),
                2
            ) AS alto_critico_pct,

            COUNT(*) FILTER (
                WHERE prf_mw >= 200
            ) AS prf_alta_mais,

            COUNT(*) FILTER (
                WHERE dentro_evento_fogo IS TRUE
            ) AS focos_em_eventos,

            COUNT(
                DISTINCT municipio
            ) AS municipios_com_focos

        FROM focos
        {where}
        """,
        parametros,
    )

    return {
        "ambiente": ambiente,
        "modo": modo,
        **resultado,
    }


# ============================================================
# DESTAQUES
# ============================================================

@app.get("/api/destaques")
def destaques(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    dados_dashboard = dashboard(
        ambiente,
        modo,
        municipio,
        em_uc,
        em_ti,
        data_inicio,
        data_fim,
    )

    top_municipio = one(
        f"""
        SELECT
            estado,
            municipio,
            COUNT(*) AS total
        FROM focos
        {aand(where, 'municipio IS NOT NULL')}
        GROUP BY
            estado,
            municipio
        ORDER BY total DESC
        LIMIT 1
        """,
        parametros,
    )

    top_bioma = one(
        f"""
        SELECT
            bioma,
            COUNT(*) AS total
        FROM focos
        {aand(where, 'bioma IS NOT NULL')}
        GROUP BY bioma
        ORDER BY total DESC
        LIMIT 1
        """,
        parametros,
    )

    top_uso = one(
        f"""
        SELECT
            uso_solo,
            COUNT(*) AS total
        FROM focos
        {aand(where, 'uso_solo IS NOT NULL')}
        GROUP BY uso_solo
        ORDER BY total DESC
        LIMIT 1
        """,
        parametros,
    )

    top_satelite = one(
        f"""
        SELECT
            satelite,
            COUNT(*) AS total
        FROM focos
        {aand(where, 'satelite IS NOT NULL')}
        GROUP BY satelite
        ORDER BY total DESC
        LIMIT 1
        """,
        parametros,
    )

    extra = {}

    if ambiente == "maranhao":
        extra = one(
            f"""
            SELECT

                COUNT(*) FILTER (
                    WHERE em_unidade_conservacao IS TRUE
                ) AS focos_em_unidade_conservacao,

                COUNT(*) FILTER (
                    WHERE em_terra_indigena IS TRUE
                ) AS focos_em_terra_indigena,

                COUNT(*) FILTER (
                    WHERE rodovia_proxima_1km IS TRUE
                ) AS focos_proximos_rodovia_1km,

                COUNT(*) FILTER (
                    WHERE linha_energia_proxima_1km IS TRUE
                ) AS focos_proximos_energia_1km

            FROM focos
            {where}
            """,
            parametros,
        )

    return {
        **dados_dashboard,
        **extra,
        "municipio_lider": top_municipio,
        "bioma_predominante": top_bioma,
        "uso_solo_predominante": top_uso,
        "satelite_predominante": top_satelite,
    }


# ============================================================
# MAPA
# ============================================================

@app.get("/api/mapa")
def mapa(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    risco: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 3000,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        risco=risco,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        "geom IS NOT NULL",
    )

    parametros.append(limite)

    registros = all_rows(
        f"""
        SELECT
            id_foco,
            data_hora_utc,
            data_hora_local,
            satelite,
            estado,
            municipio,
            bioma,
            classe_risco,

            COALESCE(
                risco_fogo_enriquecido,
                risco_fogo_original
            ) AS risco_fogo_exibicao,

            prf_mw,
            classe_prf,

            uso_solo,
            descricao_uso_solo_500m,

            classe_relevo,
            descricao_terreno_500m,

            dentro_evento_fogo,

            em_terra_indigena,
            terra_indigena_nome,

            em_unidade_conservacao,
            unidade_conservacao_nome,

            rodovia_mais_proxima,
            rodovia_jurisdicao,
            distancia_rodovia_m,

            ST_AsGeoJSON(geom)::json AS geometry

        FROM focos
        {where}

        ORDER BY data_hora_utc DESC

        LIMIT %s
        """,
        parametros,
    )

    features = []

    for registro in registros:
        geometry = registro.pop("geometry")

        features.append(
            {
                "type": "Feature",
                "id": registro["id_foco"],
                "geometry": geometry,
                "properties": registro,
            }
        )

    return {
        "type": "FeatureCollection",
        "quantidade": len(features),
        "features": features,
    }


# ============================================================
# KERNEL
# ============================================================

@app.get("/api/kernel")
def kernel(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 10000,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    parametros.append(limite)

    return {
        "pontos": all_rows(
            f"""
            SELECT
                latitude,
                longitude,
                1 AS peso
            FROM focos
            {where}
            ORDER BY data_hora_utc DESC
            LIMIT %s
            """,
            parametros,
        )
    }


# ============================================================
# RANKINGS
# ============================================================

@app.get("/api/ranking/regioes")
def ranking_regioes(
    modo: MODO = "todos",
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    where, parametros = wh(
        "brasil",
        modo,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    return all_rows(
        f"""
        SELECT

            CASE
                WHEN estado_id IN (
                    11,12,13,14,15,16,17
                )
                THEN 'Norte'

                WHEN estado_id IN (
                    21,22,23,24,25,26,27,28,29
                )
                THEN 'Nordeste'

                WHEN estado_id IN (
                    31,32,33,35
                )
                THEN 'Sudeste'

                WHEN estado_id IN (
                    41,42,43
                )
                THEN 'Sul'

                WHEN estado_id IN (
                    50,51,52,53
                )
                THEN 'Centro-Oeste'

                ELSE 'Sem região'
            END AS regiao,

            COUNT(*) AS total_focos

        FROM focos
        {where}

        GROUP BY 1
        ORDER BY total_focos DESC
        """,
        parametros,
    )


@app.get("/api/ranking/estados")
def ranking_estados(
    modo: MODO = "todos",
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 10,
):
    where, parametros = wh(
        "brasil",
        modo,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        "estado IS NOT NULL",
    )

    parametros.append(limite)

    return all_rows(
        f"""
        SELECT
            estado,
            COUNT(*) AS total_focos
        FROM focos
        {where}
        GROUP BY estado
        ORDER BY total_focos DESC
        LIMIT %s
        """,
        parametros,
    )


@app.get("/api/ranking/municipios")
def ranking_municipios(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 10,
):
    where, parametros = wh(
        ambiente,
        modo,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        "municipio IS NOT NULL",
    )

    parametros.append(limite)

    return all_rows(
        f"""
        SELECT
            estado,
            municipio,
            COUNT(*) AS total_focos,

            COUNT(*) FILTER (
                WHERE classe_risco IN ('Alto','Crítico')
            ) AS alto_critico,

            COUNT(*) FILTER (
                WHERE dentro_evento_fogo IS TRUE
            ) AS focos_em_eventos

        FROM focos
        {where}

        GROUP BY
            estado,
            municipio

        ORDER BY total_focos DESC
        LIMIT %s
        """,
        parametros,
    )


# ============================================================
# SÉRIE TEMPORAL
# ============================================================

@app.get("/api/series/temporal")
def serie_temporal(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    return all_rows(
        f"""
        SELECT

            date_trunc(
                'hour',
                data_hora_utc
            ) AS periodo,

            COUNT(*) AS total_focos,

            COUNT(*) FILTER (
                WHERE classe_risco IN ('Alto','Crítico')
            ) AS alto_critico

        FROM focos
        {where}

        GROUP BY 1
        ORDER BY 1
        """,
        parametros,
    )


# ============================================================
# DISTRIBUIÇÕES
# ============================================================

def distribuicao(
    coluna,
    alias,
    ambiente,
    modo,
    municipio,
    em_uc,
    em_ti,
    data_inicio,
    data_fim,
):
    where, parametros = wh(
        ambiente,
        modo,
        municipio=municipio,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    return all_rows(
        f"""
        SELECT
            COALESCE(
                {coluna},
                'Sem dado'
            ) AS {alias},

            COUNT(*) AS total

        FROM focos
        {where}

        GROUP BY 1
        ORDER BY total DESC
        """,
        parametros,
    )


@app.get("/api/distribuicao/risco")
def distribuicao_risco(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    return distribuicao(
        "classe_risco",
        "classe",
        ambiente,
        modo,
        municipio,
        em_uc,
        em_ti,
        data_inicio,
        data_fim,
    )


@app.get("/api/distribuicao/biomas")
def distribuicao_biomas(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    return distribuicao(
        "bioma",
        "bioma",
        ambiente,
        modo,
        municipio,
        em_uc,
        em_ti,
        data_inicio,
        data_fim,
    )


@app.get("/api/distribuicao/uso-solo")
def distribuicao_uso_solo(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    return distribuicao(
        "uso_solo",
        "uso_solo",
        ambiente,
        modo,
        municipio,
        em_uc,
        em_ti,
        data_inicio,
        data_fim,
    )


@app.get("/api/distribuicao/relevo")
def distribuicao_relevo(
    modo: MODO = "todos",
    municipio: Optional[str] = None,
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
):
    return distribuicao(
        "classe_relevo",
        "classe_relevo",
        "maranhao",
        modo,
        municipio,
        em_uc,
        em_ti,
        data_inicio,
        data_fim,
    )


# ============================================================
# EVENTOS
# ============================================================

@app.get("/api/eventos")
def eventos(
    ambiente: AMBIENTE = "brasil",
    modo: MODO = "todos",
    em_uc: Optional[bool] = None,
    em_ti: Optional[bool] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 8,
):
    where, parametros = wh(
        ambiente,
        modo,
        evento=True,
        em_uc=em_uc,
        em_ti=em_ti,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        """
        COALESCE(
            id_evento_fogo,
            id_evento_mais_proximo
        ) IS NOT NULL
        """,
    )

    parametros.append(limite)

    return all_rows(
        f"""
        SELECT

            COALESCE(
                id_evento_fogo,
                id_evento_mais_proximo
            ) AS id_evento,

            MAX(
                COALESCE(
                    status_evento_fogo,
                    status_evento_mais_proximo
                )
            ) AS status_evento,

            MAX(
                area_evento_km2
            ) AS area_evento_km2,

            COUNT(*) AS focos_presentes_na_base,

            MAX(
                max_prf_evento_mw
            ) AS max_prf_evento_mw

        FROM focos
        {where}

        GROUP BY 1
        ORDER BY focos_presentes_na_base DESC
        LIMIT %s
        """,
        parametros,
    )


# ============================================================
# TERRITORIALIDADES — MARANHÃO
# ============================================================

@app.get("/api/territorial/maranhao/ucs")
def unidades_conservacao(
    modo: MODO = "todos",
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 20,
):
    where, parametros = wh(
        "maranhao",
        modo,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        """
        em_unidade_conservacao IS TRUE
        AND unidade_conservacao_nome IS NOT NULL
        """,
    )

    parametros.append(limite)

    return all_rows(
        f"""
        SELECT
            unidade_conservacao_nome AS nome,
            MAX(
                unidade_conservacao_categoria
            ) AS categoria,
            COUNT(*) AS total_focos

        FROM focos
        {where}

        GROUP BY unidade_conservacao_nome
        ORDER BY total_focos DESC
        LIMIT %s
        """,
        parametros,
    )


@app.get("/api/territorial/maranhao/tis")
def terras_indigenas(
    modo: MODO = "todos",
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limite: int = 20,
):
    where, parametros = wh(
        "maranhao",
        modo,
        data_inicio=data_inicio,
        data_fim=data_fim,
    )

    where = aand(
        where,
        """
        em_terra_indigena IS TRUE
        AND terra_indigena_nome IS NOT NULL
        """,
    )

    parametros.append(limite)

    return all_rows(
        f"""
        SELECT
            terra_indigena_nome AS nome,
            MAX(
                terra_indigena_etnia
            ) AS etnia,
            COUNT(*) AS total_focos

        FROM focos
        {where}

        GROUP BY terra_indigena_nome
        ORDER BY total_focos DESC
        LIMIT %s
        """,
        parametros,
    )


# ============================================================
# FICHA INDIVIDUAL DO FOCO
# ============================================================

@app.get("/api/focos/{id_foco}/ficha")
def ficha(
    id_foco: str,
):
    registro = one(
        """
        SELECT
            *,
            COALESCE(
                risco_fogo_enriquecido,
                risco_fogo_original
            ) AS risco_fogo_exibicao
        FROM focos
        WHERE id_foco=%s
        """,
        [id_foco],
    )

    if not registro:
        raise HTTPException(
            status_code=404,
            detail="Foco não encontrado",
        )

    return {
        "localizacao": {
            "municipio": registro["municipio"],
            "estado": registro["estado"],
            "data_hora_local": registro["data_hora_local"],
            "satelite": registro["satelite"],
        },

        "fogo": {
            "classe_risco": registro["classe_risco"],
            "risco_fogo": registro["risco_fogo_exibicao"],
            "prf_mw": registro["prf_mw"],
            "classe_prf": registro["classe_prf"],
        },

        "uso_cobertura": {
            "uso_solo_ponto": registro["uso_solo"],
            "descricao_500m": registro[
                "descricao_uso_solo_500m"
            ],
        },

        "relevo": {
            "classe_relevo": registro["classe_relevo"],
            "descricao_500m": registro[
                "descricao_terreno_500m"
            ],
        },

        "territorialidades": {
            "unidade_conservacao": {
                "dentro": registro[
                    "em_unidade_conservacao"
                ],
                "nome": registro[
                    "unidade_conservacao_nome"
                ],
            },

            "terra_indigena": {
                "dentro": registro[
                    "em_terra_indigena"
                ],
                "nome": registro[
                    "terra_indigena_nome"
                ],
            },

            "rodovia": {
                "nome": registro[
                    "rodovia_mais_proxima"
                ],
                "distancia_m": registro[
                    "distancia_rodovia_m"
                ],
            },
        },
    }
