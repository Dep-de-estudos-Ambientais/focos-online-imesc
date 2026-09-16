const API = 'http://127.0.0.1:8000';
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('pt-BR');

const st = {
    env: 'brasil',
    mode: 'todos',
    map: null,
    layers: {},
    charts: {}
};

/* =========================================================
   ROTAS DA API
   ========================================================= */

const EP = {
    municipios: '/api/municipios',
    destaques: '/api/destaques',
    mapa: '/api/mapa',
    kernel: '/api/kernel',

    regioes: '/api/ranking/regioes',
    estados: '/api/ranking/estados',
    rankingMunicipios: '/api/ranking/municipios',

    serie: '/api/series/temporal',
    risco: '/api/distribuicao/risco',
    biomas: '/api/distribuicao/biomas',
    uso: '/api/distribuicao/uso-solo',
    relevo: '/api/distribuicao/relevo',

    eventos: '/api/eventos',
    eventosMapa: '/api/eventos/mapa',

    ucs: '/api/territorial/maranhao/ucs',
    tis: '/api/territorial/maranhao/tis',

    coropletico: '/api/coropletico/maranhao/municipios'
};


/* =========================================================
   FUNÇÕES GERAIS
   ========================================================= */

function qp(obj) {

    const params = new URLSearchParams();

    Object.entries(obj || {}).forEach(([key, value]) => {

        if (
            value !== '' &&
            value !== null &&
            value !== undefined
        ) {
            params.set(key, value);
        }

    });

    return params.toString();
}


async function api(path, params = {}) {

    const query = qp(params);

    const url =
        `${API}${path}${query ? '?' + query : ''}`;

    const response = await fetch(url);

    if (!response.ok) {

        const body = await response.text();

        throw new Error(
            `${response.status} ${response.statusText} — ${body}`
        );
    }

    return response.json();
}


/* =========================================================
   FILTROS ATUAIS
   ========================================================= */

function pars() {

    return {

        ambiente: st.env,

        modo: st.mode,

        municipio:
            $('municipio')?.value || '',

        data_inicio:
            $('start')?.value || '',

        data_fim:
            $('end')?.value || '',

        em_uc:
            st.env === 'maranhao' &&
                $('fUc')?.checked
                ? true
                : null,

        em_ti:
            st.env === 'maranhao' &&
                $('fTi')?.checked
                ? true
                : null
    };
}


/* =========================================================
   GRÁFICOS
   ========================================================= */

function chart(id, type, labels, data) {

    const element = $(id);

    if (!element) return;

    if (st.charts[id]) {
        st.charts[id].destroy();
    }

    st.charts[id] = new Chart(
        element,
        {
            type: type,

            data: {

                labels: labels,

                datasets: [{
                    data: data,

                    backgroundColor: '#f48a52',

                    borderColor: '#f04d3f',

                    borderWidth: 2,

                    tension:
                        type === 'line'
                            ? 0.25
                            : undefined
                }]
            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                plugins: {

                    legend: {
                        display: false
                    }
                },

                scales:
                    type === 'doughnut'
                        ? {}
                        : {
                            y: {
                                beginAtZero: true
                            }
                        }
            }
        }
    );
}


/* =========================================================
   MAPA PRINCIPAL
   ========================================================= */

function initMap() {

    st.map = L.map('map')
        .setView(
            [-5.2, -45],
            5
        );

    L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }
    ).addTo(st.map);


    /* FOCOS */

    st.layers.focos =
        L.layerGroup()
            .addTo(st.map);


    /* RASTERS */

    st.layers.mb = null;

    st.layers.rel = null;


    /* KERNEL */

    st.layers.kernel = null;


    /* EVENTOS ATIVOS */

    st.layers.ea =
        L.geoJSON(
            null,
            {
                style: {
                    color: '#ef4d3f',
                    weight: 2,
                    fillOpacity: 0.12
                }
            }
        );


    /* EVENTOS EM OBSERVAÇÃO */

    st.layers.eo =
        L.geoJSON(
            null,
            {
                style: {
                    color: '#f0a128',
                    weight: 2,
                    fillOpacity: 0.08,
                    dashArray: '5,5'
                }
            }
        );


    /* UNIDADES DE CONSERVAÇÃO */

    st.layers.uc =
        L.geoJSON(
            null,
            {
                style: {
                    color: '#2b8a5a',
                    weight: 2,
                    fillOpacity: 0.08
                }
            }
        );


    /* TERRAS INDÍGENAS */

    st.layers.ti =
        L.geoJSON(
            null,
            {
                style: {
                    color: '#7446a6',
                    weight: 2,
                    fillOpacity: 0.08
                }
            }
        );


    /* RODOVIAS */

    st.layers.road =
        L.layerGroup();


    /* COROPLÉTICO MUNICIPAL */

    st.layers.choro =
        L.geoJSON(
            null,
            {

                style: feature => {

                    const n =
                        Number(
                            feature.properties?.total_focos
                        ) || 0;

                    let color;

                    if (n > 100) {

                        color = '#a50f15';

                    } else if (n > 50) {

                        color = '#de2d26';

                    } else if (n > 20) {

                        color = '#fb6a4a';

                    } else if (n > 5) {

                        color = '#fcae91';

                    } else {

                        color = '#fee5d9';
                    }

                    return {

                        color: '#ffffff',

                        weight: 1,

                        fillColor: color,

                        fillOpacity: 0.70
                    };
                },


                onEachFeature:
                    (feature, layer) => {

                        const p =
                            feature.properties || {};

                        const nome =
                            p.municipio ||
                            p.nome ||
                            'Município';

                        layer.bindTooltip(
                            `${nome}: ${nf.format(
                                p.total_focos || 0
                            )} focos`
                        );
                    }
            }
        );
}


/* =========================================================
   MAPBIOMAS E RELEVO
   ========================================================= */

function rebuildRaster() {

    const mapbiomasWasOn =
        !!(
            st.layers.mb &&
            st.map.hasLayer(st.layers.mb)
        );

    const relevoWasOn =
        !!(
            st.layers.rel &&
            st.map.hasLayer(st.layers.rel)
        );


    if (
        st.layers.mb &&
        st.map.hasLayer(st.layers.mb)
    ) {

        st.map.removeLayer(
            st.layers.mb
        );
    }


    if (
        st.layers.rel &&
        st.map.hasLayer(st.layers.rel)
    ) {

        st.map.removeLayer(
            st.layers.rel
        );
    }


    /* MAPBIOMAS
       Brasil -> raster Brasil
       Maranhão -> raster Maranhão
    */

    st.layers.mb =
        L.tileLayer(

            `${API}/api/tiles/mapbiomas/${st.env}/{z}/{x}/{y}.png`,

            {

                opacity:
                    Number(
                        $('mapbiomasOpacity')?.value
                        ?? 0.65
                    ),

                maxZoom: 14
            }
        );


    /* RELEVO
       disponível apenas no Maranhão
    */

    st.layers.rel =
        L.tileLayer(

            `${API}/api/tiles/relevo/maranhao/{z}/{x}/{y}.png`,

            {

                opacity:
                    Number(
                        $('relevoOpacity')?.value
                        ?? 0.65
                    ),

                maxZoom: 14
            }
        );


    if (
        $('mapbiomasOn')?.checked ||
        mapbiomasWasOn
    ) {

        st.layers.mb.addTo(
            st.map
        );
    }


    if (
        st.env === 'maranhao' &&
        (
            $('relevoOn')?.checked ||
            relevoWasOn
        )
    ) {

        st.layers.rel.addTo(
            st.map
        );
    }
}


/* =========================================================
   MUNICÍPIOS
   ========================================================= */

async function municipios() {

    const dados =
        await api(
            EP.municipios,
            {
                ambiente: st.env
            }
        );


    if (!$('municipio')) return;


    $('municipio').innerHTML =
        '<option value="">Todos</option>' +

        dados.map(
            item =>
                `<option value="${item.municipio}">
                    ${item.municipio}
                </option>`
        ).join('');
}


/* =========================================================
   INFOGRÁFICO DE DESTAQUES
   ========================================================= */

async function highlights() {

    const d =
        await api(
            EP.destaques,
            pars()
        );


    const cards = [

        [
            '🔥',
            nf.format(
                d.total_focos || 0
            ),
            'Focos nas últimas 24 h'
        ],

        [
            '⚠️',
            `${d.alto_critico_pct ?? 0}%`,
            'Alto + Crítico'
        ],

        [
            '📍',
            d.municipio_lider?.municipio || '—',
            'Município líder'
        ],

        [
            '🌿',
            d.bioma_predominante?.bioma || '—',
            'Bioma predominante'
        ],

        [
            '🛰️',
            d.satelite_predominante?.satelite || '—',
            'Satélite predominante'
        ],

        [
            '🌾',
            d.uso_solo_predominante?.uso_solo || '—',
            'Uso do solo predominante'
        ],

        [
            '🔥',
            nf.format(
                d.focos_em_eventos || 0
            ),
            'Focos em eventos'
        ],

        [
            '☀️',
            nf.format(
                d.prf_alta_mais || 0
            ),
            'PRF ≥ 200 MW'
        ]
    ];


    /* INDICADORES EXCLUSIVOS DO MARANHÃO */

    if (st.env === 'maranhao') {

        cards.push(

            [
                '🌳',
                nf.format(
                    d.focos_em_unidade_conservacao || 0
                ),
                'Focos em UCs'
            ],

            [
                '🪶',
                nf.format(
                    d.focos_em_terra_indigena || 0
                ),
                'Focos em TIs'
            ]
        );
    }


    if (!$('cards')) return;


    $('cards').innerHTML =
        cards.map(
            card => `

                <div class="card">

                    <span>
                        ${card[0]}
                    </span>

                    <strong>
                        ${card[1]}
                    </strong>

                    <b>
                        ${card[2]}
                    </b>

                    <small>
                        Recorte atual da plataforma
                    </small>

                </div>
            `
        ).join('');
}


/* =========================================================
   FOCOS NO MAPA
   ========================================================= */

async function focos() {

    const dados =
        await api(
            EP.mapa,
            pars()
        );


    st.layers.focos
        .clearLayers();


    (dados.features || [])
        .forEach(feature => {

            if (
                !feature.geometry ||
                !feature.geometry.coordinates
            ) {
                return;
            }


            const [
                longitude,
                latitude
            ] =
                feature.geometry.coordinates;


            const p =
                feature.properties || {};


            let cor =
                '#7b8794';


            switch (
            p.classe_risco
            ) {

                case 'Crítico':

                    cor = '#c53a32';

                    break;


                case 'Alto':

                    cor = '#e4772a';

                    break;


                case 'Médio':

                    cor = '#e0aa2f';

                    break;


                case 'Baixo':

                    cor = '#63a85b';

                    break;


                case 'Mínimo':

                    cor = '#42a5a5';

                    break;
            }


            const marker =
                L.circleMarker(
                    [
                        latitude,
                        longitude
                    ],
                    {

                        radius: 5,

                        color: '#ffffff',

                        weight: 1,

                        fillColor: cor,

                        fillOpacity: 0.90
                    }
                );


            const riscoValor =
                p.risco_fogo_exibicao ??
                p.risco_fogo ??
                '—';


            marker.bindPopup(`

                <b>
                    ${p.municipio || '—'}
                    /
                    ${p.estado || '—'}
                </b>

                <br><br>

                <b>Risco:</b>
                ${p.classe_risco || '—'}

                <br>

                <b>Valor do risco:</b>
                ${riscoValor}

                <br>

                <b>PRF:</b>
                ${p.prf_mw ?? '—'} MW

                <br>

                <b>Classe PRF:</b>
                ${p.classe_prf || '—'}

                <br>

                <b>Uso do solo:</b>
                ${p.uso_solo || '—'}

                <br>

                <b>Satélite:</b>
                ${p.satelite || '—'}

            `);


            /*
             FICHA DETALHADA
             SOMENTE MARANHÃO
            */

            if (
                st.env === 'maranhao'
            ) {

                marker.on(
                    'click',
                    () =>
                        drawer(
                            feature.id ||
                            p.id_foco
                        )
                );
            }


            marker.addTo(
                st.layers.focos
            );
        });
}


/* =========================================================
   KERNEL
   ========================================================= */

async function kernel() {

    const dados =
        await api(
            EP.kernel,
            pars()
        );


    if (
        st.layers.kernel &&
        st.map.hasLayer(
            st.layers.kernel
        )
    ) {

        st.map.removeLayer(
            st.layers.kernel
        );
    }


    const pontos =
        (dados.pontos || [])
            .map(
                p => [
                    p.latitude,
                    p.longitude,
                    1
                ]
            );


    st.layers.kernel =
        L.heatLayer(
            pontos,
            {

                radius: 18,

                blur: 20
            }
        );


    if (
        $('kernelOn')?.checked
    ) {

        st.layers.kernel.addTo(
            st.map
        );
    }
}


/* =========================================================
   BRASIL
   REGIÕES + ESTADOS + MUNICÍPIOS
   ========================================================= */

async function comparisons() {

    if (
        st.env !== 'brasil'
    ) {

        $('brCompare')
            ?.classList
            .add('hidden');

        return;
    }


    $('brCompare')
        ?.classList
        .remove('hidden');


    const parametros = {

        modo:
            st.mode,

        data_inicio:
            $('start')?.value || '',

        data_fim:
            $('end')?.value || ''
    };


    const [
        regioes,
        estados,
        municipiosRanking
    ] =
        await Promise.all([

            api(
                EP.regioes,
                parametros
            ),

            api(
                EP.estados,
                parametros
            ),

            api(
                EP.rankingMunicipios,
                {
                    ambiente: 'brasil',
                    ...parametros
                }
            )
        ]);


    chart(
        'regionChart',
        'bar',

        regioes.map(
            x => x.regiao
        ),

        regioes.map(
            x => x.total_focos
        )
    );


    chart(
        'stateChart',
        'bar',

        estados.map(
            x => x.estado
        ),

        estados.map(
            x => x.total_focos
        )
    );


    chart(
        'munChart',
        'bar',

        municipiosRanking.map(
            x => x.municipio
        ),

        municipiosRanking.map(
            x => x.total_focos
        )
    );
}


/* =========================================================
   GRÁFICOS ANALÍTICOS
   ========================================================= */

async function charts() {

    const parametros =
        pars();


    const [
        temporal,
        risco,
        biomas,
        uso
    ] =
        await Promise.all([

            api(
                EP.serie,
                parametros
            ),

            api(
                EP.risco,
                parametros
            ),

            api(
                EP.biomas,
                parametros
            ),

            api(
                EP.uso,
                parametros
            )
        ]);


    /* SÉRIE TEMPORAL */

    chart(
        'temporalChart',
        'line',

        temporal.map(
            x => {

                const data =
                    new Date(
                        x.periodo
                    );


                if (
                    Number.isNaN(
                        data.getTime()
                    )
                ) {

                    return x.periodo;
                }


                return data
                    .toLocaleString(
                        'pt-BR',
                        {

                            day: '2-digit',

                            month: '2-digit',

                            hour: '2-digit',

                            minute: '2-digit'
                        }
                    );
            }
        ),

        temporal.map(
            x => x.total_focos
        )
    );


    /* RISCO */

    chart(
        'riskChart',
        'doughnut',

        risco.map(
            x => x.classe
        ),

        risco.map(
            x => x.total
        )
    );


    /* BIOMAS */

    chart(
        'biomeChart',
        'bar',

        biomas.map(
            x => x.bioma
        ),

        biomas.map(
            x => x.total
        )
    );


    /* USO E COBERTURA */

    const usoTop =
        uso.slice(
            0,
            10
        );


    chart(
        'useChart',
        'bar',

        usoTop.map(
            x => x.uso_solo
        ),

        usoTop.map(
            x => x.total
        )
    );


    /* RELEVO — SOMENTE MARANHÃO */

    if (
        st.env === 'maranhao'
    ) {

        $('reliefPanel')
            ?.classList
            .remove('hidden');


        const relevo =
            await api(
                EP.relevo,
                parametros
            );


        chart(
            'reliefChart',
            'bar',

            relevo.map(
                x => x.classe_relevo
            ),

            relevo.map(
                x => x.total
            )
        );

    } else {

        $('reliefPanel')
            ?.classList
            .add('hidden');
    }
}


/* =========================================================
   TABELAS
   ========================================================= */

function tab(
    headers,
    rows
) {

    return `

        <table>

            <thead>

                <tr>

                    ${headers
            .map(
                x =>
                    `<th>${x}</th>`
            )
            .join('')
        }

                </tr>

            </thead>

            <tbody>

                ${rows
            .map(
                row => `

                                <tr>

                                    ${row
                        .map(
                            value =>
                                `<td>${value ?? '—'}</td>`
                        )
                        .join('')
                    }

                                </tr>
                            `
            )
            .join('')
        }

            </tbody>

        </table>
    `;
}


/* =========================================================
   UCs E TIs
   ========================================================= */

async function protectedTables() {

    if (
        st.env !== 'maranhao'
    ) {

        $('maProtected')
            ?.classList
            .add('hidden');

        return;
    }


    $('maProtected')
        ?.classList
        .remove('hidden');


    const parametros = {

        modo:
            st.mode,

        data_inicio:
            $('start')?.value || '',

        data_fim:
            $('end')?.value || ''
    };


    const [
        unidades,
        terras
    ] =
        await Promise.all([

            api(
                EP.ucs,
                parametros
            ),

            api(
                EP.tis,
                parametros
            )
        ]);


    if ($('ucTable')) {

        $('ucTable').innerHTML =
            tab(

                [
                    'UC',
                    'Categoria',
                    'Focos'
                ],

                unidades.map(
                    x => [

                        x.nome,

                        x.categoria,

                        x.total_focos
                    ]
                )
            );
    }


    if ($('tiTable')) {

        $('tiTable').innerHTML =
            tab(

                [
                    'TI',
                    'Etnia',
                    'Focos'
                ],

                terras.map(
                    x => [

                        x.nome,

                        x.etnia,

                        x.total_focos
                    ]
                )
            );
    }
}


/* =========================================================
   EVENTOS DE FOGO
   ========================================================= */

async function events() {

    const dados =
        await api(
            EP.eventos,
            pars()
        );


    if ($('eventTitle')) {

        $('eventTitle').textContent =
            `Eventos em destaque — ${st.env === 'maranhao'
                ? 'Maranhão'
                : 'Brasil'
            }`;
    }


    if (!$('events')) return;


    $('events').innerHTML =
        (dados || [])
            .map(
                evento => `

                    <div class="event">

                        <b>
                            Evento ${evento.id_evento}
                        </b>

                        <small>
                            Status:
                            ${evento.status_evento || '—'}
                        </small>

                        <small>
                            Focos:
                            ${nf.format(
                    evento.focos_presentes_na_base || 0
                )}
                        </small>

                        <small>
                            Área:
                            ${evento.area_evento_km2 ?? '—'}
                            km²
                        </small>

                    </div>
                `
            )
            .join('');
}


/* =========================================================
   CAMADAS VETORIAIS
   ========================================================= */

async function vector(
    tipo,
    key
) {

    const dados =
        await api(
            `/api/camadas/maranhao/${tipo}`
        );


    st.layers[key]
        .clearLayers()
        .addData(
            dados
        );
}


/* =========================================================
   RODOVIAS
   ========================================================= */

async function roads() {

    const dados =
        await api(
            '/api/camadas/maranhao/rodovia'
        );


    st.layers.road
        .clearLayers();


    const geo =
        L.geoJSON(
            dados,
            {

                style: feature => {

                    const properties =
                        JSON.stringify(
                            feature.properties || {}
                        )
                            .toUpperCase();


                    const federal =
                        /BR[-\s]?\d+/.test(
                            properties
                        ) ||
                        /FEDERAL/.test(
                            properties
                        );


                    return {

                        /*
                         Convenção visual:
                         Federal = vermelho
                         Estadual = azul
                        */

                        color:
                            federal
                                ? '#c0392b'
                                : '#2f6fb0',

                        weight:
                            federal
                                ? 3
                                : 2.4,

                        opacity: 0.90
                    };
                },


                onEachFeature:
                    (feature, layer) => {

                        const properties =
                            JSON.stringify(
                                feature.properties || {}
                            );


                        const match =
                            properties.match(
                                /\b(BR|MA)[-\s]?\d{2,3}\b/i
                            );


                        if (match) {

                            const nome =
                                match[0]
                                    .replace(
                                        ' ',
                                        '-'
                                    )
                                    .toUpperCase();


                            layer.bindTooltip(
                                nome,
                                {

                                    permanent: true,

                                    direction: 'center',

                                    className:
                                        'road-label'
                                }
                            );
                        }
                    }
            }
        );


    geo.eachLayer(
        layer =>
            layer.addTo(
                st.layers.road
            )
    );
}


/* =========================================================
   MAPA COROPLÉTICO DO MARANHÃO
   ========================================================= */

async function choro() {

    const dados =
        await api(
            EP.coropletico,
            {

                modo:
                    st.mode,

                data_inicio:
                    $('start')?.value || '',

                data_fim:
                    $('end')?.value || ''
            }
        );


    st.layers.choro
        .clearLayers()
        .addData(
            dados
        );
}


/* =========================================================
   FICHA DO FOCO — EXCLUSIVA DO MARANHÃO
   ========================================================= */

async function drawer(id) {

    if (
        !id ||
        st.env !== 'maranhao'
    ) {
        return;
    }


    const dados =
        await api(
            `/api/focos/${encodeURIComponent(id)}/ficha`
        );


    const localizacao =
        dados.localizacao || {};


    const fogo =
        dados.fogo || {};


    const uso =
        dados.uso_cobertura || {};


    const relevo =
        dados.relevo || {};


    const territorial =
        dados.territorialidades ||
        dados.territorial ||
        {};


    if (!$('drawerContent')) return;


    $('drawerContent').innerHTML = `

        <h2>
            ${localizacao.municipio || '—'}
            /
            ${localizacao.estado || '—'}
        </h2>


        <h3>
            Fogo
        </h3>

        <p>

            <b>Risco:</b>
            ${fogo.classe_risco || '—'}

            <br>

            <b>Valor do risco:</b>
            ${fogo.risco_fogo ??
        fogo.risco_fogo_exibicao ??
        '—'
        }

            <br>

            <b>PRF:</b>
            ${fogo.prf_mw ?? '—'} MW

            <br>

            <b>Classe PRF:</b>
            ${fogo.classe_prf || '—'}

        </p>


        <h3>
            Uso e cobertura da terra
        </h3>

        <p>

            ${uso.descricao_500m ||
        uso.descricao_uso_solo_500m ||
        uso.uso_solo_ponto ||
        '—'
        }

        </p>


        <h3>
            Relevo
        </h3>

        <p>

            ${relevo.descricao_500m ||
        relevo.descricao_terreno_500m ||
        relevo.classe_relevo ||
        '—'
        }

        </p>


        <h3>
            Contexto territorial
        </h3>

        <p>

            <b>Unidade de Conservação:</b>

            ${territorial.unidade_conservacao_nome ||
        territorial.uc_nome ||
        'Não identificado'
        }

            <br>


            <b>Terra Indígena:</b>

            ${territorial.terra_indigena_nome ||
        territorial.ti_nome ||
        'Não identificado'
        }

            <br>


            <b>Rodovia mais próxima:</b>

            ${territorial.rodovia_mais_proxima ||
        '—'
        }

            <br>


            <b>Distância da rodovia:</b>

            ${territorial.distancia_rodovia_m ??
        '—'
        } m

        </p>
    `;


    $('drawer')
        ?.classList
        .add('open');
}


/* =========================================================
   ATUALIZAÇÃO GERAL
   ========================================================= */

async function refresh() {

    $('loading')
        ?.classList
        .remove('hidden');


    try {

        await Promise.all([

            highlights(),

            focos(),

            kernel(),

            comparisons(),

            charts(),

            protectedTables(),

            events()
        ]);

    } catch (error) {

        console.error(
            'Erro ao atualizar a plataforma:',
            error
        );


        alert(
            'Erro ao atualizar. Veja o Console do navegador e o terminal da API.'
        );

    } finally {

        $('loading')
            ?.classList
            .add('hidden');
    }
}


/* =========================================================
   CONTROLE DE CAMADAS
   ========================================================= */

function toggle(
    id,
    key,
    loader
) {

    const element =
        $(id);


    if (!element) return;


    element.onchange =
        async () => {

            try {

                if (
                    element.checked
                ) {

                    if (loader) {

                        await loader();
                    }


                    if (
                        st.layers[key] &&
                        !st.map.hasLayer(
                            st.layers[key]
                        )
                    ) {

                        st.layers[key]
                            .addTo(
                                st.map
                            );
                    }

                } else {

                    if (
                        st.layers[key] &&
                        st.map.hasLayer(
                            st.layers[key]
                        )
                    ) {

                        st.map.removeLayer(
                            st.layers[key]
                        );
                    }
                }

            } catch (error) {

                console.error(
                    `Erro ao carregar camada ${key}:`,
                    error
                );


                element.checked =
                    false;
            }
        };
}


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

document.addEventListener(
    'DOMContentLoaded',
    async () => {

        /* MAPA */

        initMap();


        /* RASTERS */

        rebuildRaster();


        /* PRIMEIRO CARREGAMENTO */

        try {

            await municipios();

            await refresh();

        } catch (error) {

            console.error(
                'Erro na inicialização:',
                error
            );
        }


        /* =================================================
           AMBIENTE BRASIL / MARANHÃO
           ================================================= */

        document
            .querySelectorAll(
                '[data-env]'
            )
            .forEach(
                button => {

                    button.onclick =
                        async () => {

                            st.env =
                                button.dataset.env;


                            document
                                .querySelectorAll(
                                    '[data-env]'
                                )
                                .forEach(
                                    item => {

                                        item.classList.toggle(
                                            'active',
                                            item === button
                                        );
                                    }
                                );


                            /* ELEMENTOS EXCLUSIVOS MA */

                            $('maFilters')
                                ?.classList
                                .toggle(
                                    'hidden',
                                    st.env !== 'maranhao'
                                );


                            $('maLayers')
                                ?.classList
                                .toggle(
                                    'hidden',
                                    st.env !== 'maranhao'
                                );


                            $('reliefControls')
                                ?.classList
                                .toggle(
                                    'hidden',
                                    st.env !== 'maranhao'
                                );


                            /* REMOVE CAMADAS MA
                               QUANDO VOLTAR AO BRASIL
                            */

                            if (
                                st.env !== 'maranhao'
                            ) {

                                [
                                    'rel',
                                    'uc',
                                    'ti',
                                    'road',
                                    'choro'
                                ]
                                    .forEach(
                                        key => {

                                            if (
                                                st.layers[key] &&
                                                st.map.hasLayer(
                                                    st.layers[key]
                                                )
                                            ) {

                                                st.map.removeLayer(
                                                    st.layers[key]
                                                );
                                            }
                                        }
                                    );
                            }


                            rebuildRaster();


                            await municipios();


                            await refresh();
                        };
                }
            );


        /* =================================================
           TODOS / SATÉLITE DE REFERÊNCIA
           ================================================= */

        document
            .querySelectorAll(
                '[data-mode]'
            )
            .forEach(
                button => {

                    button.onclick =
                        async () => {

                            st.mode =
                                button.dataset.mode;


                            document
                                .querySelectorAll(
                                    '[data-mode]'
                                )
                                .forEach(
                                    item => {

                                        item.classList.toggle(
                                            'active',
                                            item === button
                                        );
                                    }
                                );


                            await refresh();
                        };
                }
            );


        /* =================================================
           BOTÃO APLICAR
           ================================================= */

        if ($('apply')) {

            $('apply').onclick =
                refresh;
        }


        /* =================================================
           FECHAR FICHA
           ================================================= */

        if ($('close')) {

            $('close').onclick =
                () => {

                    $('drawer')
                        ?.classList
                        .remove('open');
                };
        }


        /* =================================================
           MAPBIOMAS
           ================================================= */

        if ($('mapbiomasOn')) {

            $('mapbiomasOn').onchange =
                () => {

                    if (
                        $('mapbiomasOn').checked
                    ) {

                        if (
                            st.layers.mb &&
                            !st.map.hasLayer(
                                st.layers.mb
                            )
                        ) {

                            st.layers.mb
                                .addTo(
                                    st.map
                                );
                        }

                    } else {

                        if (
                            st.layers.mb &&
                            st.map.hasLayer(
                                st.layers.mb
                            )
                        ) {

                            st.map.removeLayer(
                                st.layers.mb
                            );
                        }
                    }
                };
        }


        /* TRANSPARÊNCIA MAPBIOMAS */

        if ($('mapbiomasOpacity')) {

            $('mapbiomasOpacity').oninput =
                event => {

                    st.layers.mb
                        ?.setOpacity(
                            Number(
                                event.target.value
                            )
                        );
                };
        }


        /* =================================================
           RELEVO
           ================================================= */

        if ($('relevoOn')) {

            $('relevoOn').onchange =
                () => {

                    if (
                        st.env !== 'maranhao'
                    ) {

                        $('relevoOn').checked =
                            false;

                        return;
                    }


                    if (
                        $('relevoOn').checked
                    ) {

                        if (
                            st.layers.rel &&
                            !st.map.hasLayer(
                                st.layers.rel
                            )
                        ) {

                            st.layers.rel
                                .addTo(
                                    st.map
                                );
                        }

                    } else {

                        if (
                            st.layers.rel &&
                            st.map.hasLayer(
                                st.layers.rel
                            )
                        ) {

                            st.map.removeLayer(
                                st.layers.rel
                            );
                        }
                    }
                };
        }


        /* TRANSPARÊNCIA RELEVO */

        if ($('relevoOpacity')) {

            $('relevoOpacity').oninput =
                event => {

                    st.layers.rel
                        ?.setOpacity(
                            Number(
                                event.target.value
                            )
                        );
                };
        }


        /* =================================================
           FOCOS
           ================================================= */

        if ($('focosOn')) {

            $('focosOn').onchange =
                () => {

                    if (
                        $('focosOn').checked
                    ) {

                        if (
                            !st.map.hasLayer(
                                st.layers.focos
                            )
                        ) {

                            st.layers.focos
                                .addTo(
                                    st.map
                                );
                        }

                    } else {

                        if (
                            st.map.hasLayer(
                                st.layers.focos
                            )
                        ) {

                            st.map.removeLayer(
                                st.layers.focos
                            );
                        }
                    }
                };
        }


        /* =================================================
           KERNEL
           ================================================= */

        toggle(
            'kernelOn',
            'kernel'
        );


        /* =================================================
           EVENTOS ATIVOS
           ================================================= */

        toggle(

            'evtA',

            'ea',

            async () => {

                const dados =
                    await api(
                        EP.eventosMapa,
                        {
                            ambiente:
                                st.env,

                            grupo:
                                'ativos'
                        }
                    );


                st.layers.ea
                    .clearLayers()
                    .addData(
                        dados
                    );
            }
        );


        /* =================================================
           EVENTOS EM OBSERVAÇÃO
           ================================================= */

        toggle(

            'evtO',

            'eo',

            async () => {

                const dados =
                    await api(
                        EP.eventosMapa,
                        {
                            ambiente:
                                st.env,

                            grupo:
                                'observacao'
                        }
                    );


                st.layers.eo
                    .clearLayers()
                    .addData(
                        dados
                    );
            }
        );


        /* =================================================
           UNIDADES DE CONSERVAÇÃO
           ================================================= */

        toggle(

            'ucOn',

            'uc',

            () =>
                vector(
                    'uc',
                    'uc'
                )
        );


        /* =================================================
           TERRAS INDÍGENAS
           ================================================= */

        toggle(

            'tiOn',

            'ti',

            () =>
                vector(
                    'ti',
                    'ti'
                )
        );


        /* =================================================
           RODOVIAS
           ================================================= */

        toggle(
            'roadOn',
            'road',
            roads
        );


        /* =================================================
           COROPLÉTICO MUNICIPAL
           ================================================= */

        toggle(
            'choroOn',
            'choro',
            choro
        );
    }
);