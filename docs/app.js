const $=id=>document.getElementById(id), nf=new Intl.NumberFormat('pt-BR');
const PATH={mun:'camadas/Malha Municipal territorial.geojson',ti:'camadas/Terras Indigenas.geojson',road:'camadas/Trechos de Rodovias.geojson',energy:'camadas/Trechos de Linhas de Transmissão.geojson',ucEst:'camadas/Unidades de Conservação Estaduais.geojson',ucFed:'camadas/Unidades de Conservação Federais.geojson',eventActive:'data/eventos_ativos.geojson',eventObs:'data/eventos_observacao.geojson'};
const S={env:'maranhao',all:[],filtered:[],status:null,map:null,layers:{},base:{},charts:{},geo:{},territory:null};
const normalize=s=>(s??'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const val=(p,...keys)=>{for(const k of keys)if(p?.[k]!==undefined&&p[k]!==null&&p[k]!=='')return p[k];return null};
const featureProps=f=>f?.properties||{};
const focusProps=f=>f?.properties||{};
const unique=(arr)=>[...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
const countBy=(arr,fn)=>{const m={};arr.forEach(x=>{const k=fn(x)||'Sem dado';m[k]=(m[k]||0)+1});return m};
const topEntries=(obj,n=10)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);

function propName(p,type){
  const candidates=type==='mun'?['NM_MUN','municipio','MUNICIPIO','nome','NOME','name']:
    type==='ti'?['terrai_nom','terra_indigena_nome','nome','NOME','name']:
    type==='uc'?['nome_uc','NOME_UC','nome','NOME','name']:
    type==='road'?['sigla','SIGLA','rodovia','RODOVIA','br','BR','codigo','CODIGO','nome','NOME','name']:
    ['nome','NOME','name','sigla','SIGLA'];
  for(const k of candidates)if(p?.[k])return p[k];
  for(const [k,v] of Object.entries(p||{}))if(typeof v==='string'&&/nome|name|municip/i.test(k)&&v)return v;
  return 'Sem nome';
}
function riskColor(r){return {'CRITICO':'#c53a32','ALTO':'#e4772a','MEDIO':'#e0aa2f','BAIXO':'#63a85b','MINIMO':'#42a5a5'}[normalize(r)]||'#7b8794'}
function landUseColor(v){
  const n=normalize(v);
  if(n.includes('FLOREST'))return '#1f8d49';
  if(n.includes('SAVAN'))return '#7dc975';
  if(n.includes('CAMPEST'))return '#d6bc74';
  if(n.includes('PASTAG'))return '#edde8e';
  if(n.includes('AGRIC')||n.includes('LAVOUR'))return '#c762c3';
  if(n.includes('URBAN'))return '#d64541';
  if(n.includes('AGUA')||n.includes('RIO')||n.includes('LAGO')||n.includes('OCEANO'))return '#2563eb';
  if(n.includes('MOSAICO'))return '#ffefc3';
  if(n.includes('SILVIC'))return '#7a5900';
  if(n.includes('ALAG'))return '#45c2a5';
  return '#9aa3ad';
}
function focusColor(p){return $('usoSoloOn')?.checked?landUseColor(p.uso_solo||p.classe_mapbiomas):riskColor(p.classe_risco)}
function isMA(f){return normalize(focusProps(f).estado)==='MARANHAO'}

function initMap(){
  S.map=L.map('map',{preferCanvas:true,zoomAnimation:true,fadeAnimation:false,markerZoomAnimation:false}).setView([-5.2,-45],5);
  // Hierarquia fixa: nenhum polígono ou linha fica acima dos focos.
  S.map.createPane('dadosTerritoriais'); S.map.getPane('dadosTerritoriais').style.zIndex=410;
  S.map.createPane('focosPane'); S.map.getPane('focosPane').style.zIndex=640;
  S.map.createPane('prioridadePane'); S.map.getPane('prioridadePane').style.zIndex=650;
  S.focusRenderer=L.canvas({pane:'focosPane',padding:.35,tolerance:7});
  S.base.carto=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(S.map);
  S.base.sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
  S.layers.hillshade=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,opacity:.55,attribution:'Hillshade © Esri'});
  S.layers.focosNormal=L.layerGroup();
  S.layers.focosPriority=L.layerGroup();
  S.layers.focos=L.layerGroup([S.layers.focosNormal,S.layers.focosPriority]).addTo(S.map);
  S.layers.territoryHighlight=L.geoJSON(null,{pane:'dadosTerritoriais',interactive:false,style:{color:'#111',weight:4,fillColor:'#ffd54f',fillOpacity:.08}}).addTo(S.map);
}

/* Gráficos com tamanho fixo: evita ciclo de ResizeObserver / crescimento infinito */
function chart(id,type,entries,opts={}){
  const el=$(id);
  if(!el || typeof Chart==='undefined') return;

  const old=Chart.getChart ? Chart.getChart(el) : S.charts[id];
  if(old){
    try{old.destroy()}catch(_){}
  }
  delete S.charts[id];

  /* O CSS controla o tamanho visual. O canvas recebe dimensões internas estáveis. */
  el.removeAttribute('width');
  el.removeAttribute('height');
  el.width=800;
  el.height=260;

  const colors=opts.colors||entries.map(()=>'#f48a52');

  S.charts[id]=new Chart(el,{
    type,
    data:{
      labels:entries.map(x=>x[0]),
      datasets:[{
        data:entries.map(x=>x[1]),
        backgroundColor:type==='line'?undefined:colors,
        borderColor:type==='line'?'#f04d3f':colors,
        borderWidth:2,
        tension:.25,
        fill:false
      }]
    },
    options:{
      responsive:false,
      animation:false,
      plugins:{
        legend:{
          display:opts.legend??(type==='doughnut'),
          position:'bottom'
        }
      },
      scales:type==='doughnut'?{}:{y:{beginAtZero:true}}
    }
  });
}

const RISK_COLORS={'CRITICO':'#c53a32','ALTO':'#e4772a','MEDIO':'#e0aa2f','BAIXO':'#63a85b','MINIMO':'#42a5a5','SEM DADO':'#7b8794'};
function riskChartEntries(a){const order=['Crítico','Alto','Médio','Baixo','Mínimo','Sem dado'];const c=countBy(a,f=>focusProps(f).classe_risco);return order.map(k=>[k,c[k]||c[normalize(k)]||0]).filter(x=>x[1]>0)}
function biomeColor(name){const n=normalize(name);if(n.includes('AMAZON'))return '#2e8b57';if(n.includes('CERRADO'))return '#e67e22';if(n.includes('CAATINGA'))return '#d4a72c';if(n.includes('MATA ATLANTICA'))return '#5aa469';if(n.includes('PANTANAL'))return '#3f8fc5';if(n.includes('PAMPA'))return '#9b8f55';return '#9aa3ad'}
function satGroup(s){return normalize(s).includes('AQUA_M-T')||normalize(s)==='AQUA'?'Satélite de referência':'Demais satélites'}
function fmtDate(v){if(!v)return '—';const d=new Date(v);return isNaN(d)?String(v):d.toLocaleString('pt-BR')}
function isPriority(p){return ['ALTO','CRITICO'].includes(normalize(p.classe_risco))&&Number(p.prf_mw??p.frp??0)>=200&&!!p.dentro_evento_fogo}

function fillSelect(id,values,keep=true){const el=$(id);if(!el)return;const old=keep?el.value:'';el.innerHTML='<option value="">Todos</option>'+values.map(v=>`<option>${v}</option>`).join('');if(values.includes(old))el.value=old}
function setupFilters(){fillSelect('estado',unique(S.all.map(f=>focusProps(f).estado)));fillSelect('risco',unique(S.all.map(f=>focusProps(f).classe_risco)));fillSelect('bioma',unique(S.all.map(f=>focusProps(f).bioma)));const sat=$('satelite');if(sat)sat.innerHTML='<option value="">Todos</option><option value="referencia">Satélite de referência</option><option value="demais">Demais satélites</option>';refreshMunicipios()}
function refreshMunicipios(){const base=S.env==='maranhao'?S.all.filter(isMA):S.all;const estado=$('estado')?.value||'';fillSelect('municipio',unique(base.filter(f=>!estado||focusProps(f).estado===estado).map(f=>focusProps(f).municipio)))}

function applyFilters(){
  let a=S.env==='maranhao'?S.all.filter(isMA):[...S.all];
  const eq=(id,k)=>{const el=$(id);const v=el?.value||'';if(v)a=a.filter(f=>String(focusProps(f)[k]??'')===v)};
  eq('estado','estado');eq('municipio','municipio');eq('risco','classe_risco');eq('bioma','bioma');
  const sat=$('satelite')?.value||'';
  if(sat==='referencia')a=a.filter(f=>satGroup(focusProps(f).satelite)==='Satélite de referência');
  if(sat==='demais')a=a.filter(f=>satGroup(focusProps(f).satelite)==='Demais satélites');
  const rec=$('recencia')?.value||'';
  if(rec){
    a=a.filter(f=>{
      const h=Number(focusProps(f).idade_foco_horas);
      if(!Number.isFinite(h))return false;
      if(rec==='recente')return h<=3;
      if(rec==='observado')return h>3&&h<=10;
      return h>10&&h<=24;
    })
  }
  const prf=$('prf')?.value||'';
  if(prf){
    const lim={alta:200,muitoalta:500,extrema:1000}[prf];
    a=a.filter(f=>Number(focusProps(f).prf_mw??focusProps(f).frp??0)>=lim)
  }
  if(S.territory){
    const {type,name}=S.territory;
    if(type==='municipio')a=a.filter(f=>normalize(focusProps(f).municipio)===normalize(name));
    if(type==='ti')a=a.filter(f=>normalize(focusProps(f).terra_indigena_nome)===normalize(name));
    if(type==='uc')a=a.filter(f=>normalize(focusProps(f).unidade_conservacao_nome)===normalize(name))
  }
  S.filtered=a;
  renderAll();
}

function cards(){
  const a=S.filtered,total=a.length;
  const high=a.filter(f=>['ALTO','CRITICO'].includes(normalize(focusProps(f).classe_risco))).length;
  const leader=topEntries(countBy(a,f=>focusProps(f).municipio),1)[0]?.[0]||'—';
  const bio=topEntries(countBy(a,f=>focusProps(f).bioma),1)[0]?.[0]||'—';
  const sat=topEntries(countBy(a,f=>focusProps(f).satelite),1)[0]?.[0]||'—';
  const use=topEntries(countBy(a,f=>focusProps(f).uso_solo||focusProps(f).classe_mapbiomas),1)[0]?.[0]||'—';
  const evt=a.filter(f=>focusProps(f).dentro_evento_fogo).length;
  const prf=a.filter(f=>Number(focusProps(f).prf_mw??0)>=200).length;
  let c=[
    ['🔥',nf.format(total),'Focos nas últimas 24 h'],
    ['⚠️',total?(100*high/total).toFixed(1)+'%':'0%','Alto + Crítico'],
    ['📍',leader,'Município líder'],
    ['🌿',bio,'Bioma predominante'],
    ['🛰️',sat,'Satélite predominante'],
    ['🌾',use,'Uso do solo predominante'],
    ['🔥',nf.format(evt),'Focos em eventos'],
    ['☀️',nf.format(prf),'PRF ≥ 200 MW']
  ];
  if(S.env==='maranhao')c.push(
    ['🌳',nf.format(a.filter(f=>focusProps(f).em_unidade_conservacao).length),'Focos em UCs'],
    ['🪶',nf.format(a.filter(f=>focusProps(f).em_terra_indigena).length),'Focos em TIs']
  );
  if($('cards'))$('cards').innerHTML=c.map(x=>`<div class="card"><div class="card-title"><span>${x[0]}</span><b>${x[2]}</b></div><strong>${x[1]}</strong><small>Recorte atual da plataforma</small></div>`).join('')
}

function popupHtml(p){
  const age=p.classe_idade_foco||((p.idade_foco_horas!=null)?`${Number(p.idade_foco_horas).toFixed(1)} h`:'—');
  return `<b>${p.municipio||'—'} / ${p.estado||'—'}</b><br><br><b>Identificado em:</b> ${fmtDate(p.data_hora_local)}<br><b>Idade do foco:</b> ${age}<br><b>Risco:</b> ${p.classe_risco||'—'}<br><b>PRF:</b> ${p.prf_mw??'—'} MW<br><b>Uso do solo:</b> ${p.uso_solo||p.classe_mapbiomas||'—'}<br><b>Satélite:</b> ${p.satelite||'—'}${isPriority(p)?'<br><br><b class="alert-text">⚠ Foco prioritário para atenção</b>':''}`
}

function bringFocosForward(){
  // A ordem dos panes é permanente. Não remova/reinsira 40 mil marcadores.
  S.map.getPane('focosPane').style.zIndex=640;
  S.map.getPane('prioridadePane').style.zIndex=650;
}
function renderFocos(){
  S.layers.focosNormal.clearLayers();
  S.layers.focosPriority.clearLayers();
  for(const f of S.filtered){
    const [lon,lat]=f.geometry?.coordinates||[];
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    const p=focusProps(f),priority=isPriority(p);
    let m;
    if(priority){
      m=L.marker([lat,lon],{pane:'prioridadePane',interactive:true,keyboard:false,icon:L.divIcon({className:'priority-wrap',html:`<span class="priority-pulse" style="--risk:${riskColor(p.classe_risco)}"></span>`,iconSize:[20,20],iconAnchor:[10,10]})});
    }else{
      m=L.circleMarker([lat,lon],{renderer:S.focusRenderer,radius:5,color:'#fff',weight:1,fillColor:focusColor(p),fillOpacity:.9});
    }
    m.on('click',()=>{m.bindPopup(popupHtml(p),{maxWidth:320}).openPopup();drawer(f)});
    m.addTo(priority?S.layers.focosPriority:S.layers.focosNormal);
  }
  bringFocosForward();
  if($('mapCount'))$('mapCount').textContent=nf.format(S.filtered.length)+' focos';
  if($('kernelOn')?.checked)renderHeat();
}

function renderHeat(){
  if(S.layers.heat)S.map.removeLayer(S.layers.heat);
  const pts=S.filtered
    .filter(f=>Array.isArray(f.geometry?.coordinates)&&Number.isFinite(f.geometry.coordinates[0])&&Number.isFinite(f.geometry.coordinates[1]))
    .map(f=>[f.geometry.coordinates[1],f.geometry.coordinates[0],1]);
  S.layers.heat=L.heatLayer(pts,{pane:'dadosTerritoriais',radius:26,blur:18,maxZoom:11,minOpacity:.38,gradient:{0.15:'#2c7bb6',0.35:'#00a6ca',0.5:'#ffff8c',0.7:'#fdae61',0.85:'#f46d43',1:'#d7191c'}});
  if($('kernelOn')?.checked)S.layers.heat.addTo(S.map)
}

function drawer(f){
  const p=focusProps(f);
  const items=[['Município',p.municipio],['Estado',p.estado],['Data/hora',fmtDate(p.data_hora_local)],['Idade do foco',p.classe_idade_foco||((p.idade_foco_horas!=null)?Number(p.idade_foco_horas).toFixed(1)+' h':'—')],['Satélite',p.satelite],['Risco',p.classe_risco],['Índice de risco de fogo',p.risco_fogo_enriquecido],['PRF (MW)',p.prf_mw],['Classe PRF',p.classe_prf],['Bioma',p.bioma],['Uso do solo',p.uso_solo||p.classe_mapbiomas],['Evento',p.id_evento_fogo],['Status evento',p.status_evento_fogo],['Elevação (m)',p.elevacao_m],['Declividade (°)',p.declividade_graus],['Relevo',p.classe_relevo],['Terra Indígena',p.terra_indigena_nome],['Unidade de Conservação',p.unidade_conservacao_nome],['Rodovia próxima',p.rodovia_mais_proxima],['Dist. rodovia (m)',p.distancia_rodovia_m],['Linha de energia',p.linha_energia_mais_proxima],['Dist. energia (m)',p.distancia_linha_energia_m]];
  const ctx500=p.descricao_uso_solo_500m||p.descricao_terreno_500m||p.uso_solo_predominante_500m||p.contexto_500m;
  const idade=p.classe_idade_foco?` classificado temporalmente como ${p.classe_idade_foco.toLowerCase()}`:'';
  const evento=p.dentro_evento_fogo?` O registro encontra-se espacialmente associado ao evento de fogo ${p.id_evento_fogo||'identificado pelo sistema'}, com situação ${p.status_evento_fogo||'não informada'}, aspecto que reforça a necessidade de acompanhamento da persistência e da evolução espacial da ocorrência.`:` Não foi identificada associação do ponto, no recorte publicado, com evento de fogo monitorado.`;
  const territorial=p.em_terra_indigena?` O ponto está inserido na Terra Indígena ${p.terra_indigena_nome||'identificada na base territorial'}.`:p.em_unidade_conservacao?` O ponto está inserido na Unidade de Conservação ${p.unidade_conservacao_nome||'identificada na base territorial'}.`:'';
  const contexto=ctx500?` A caracterização espacial do entorno de 500 metros indica ${ctx500}, informação utilizada como elemento complementar para interpretação das condições locais de cobertura e do contexto ambiental imediato.`:` A caracterização detalhada do entorno de 500 metros não está disponível no GeoJSON desta publicação; sua inclusão ocorrerá automaticamente quando os campos de contexto forem incorporados à exportação web.`;
  const prioridade=isPriority(p)?` Considerando conjuntamente a classe de risco ${p.classe_risco}, a Potência Radiativa do Fogo (PRF) de ${p.prf_mw??'—'} MW e a inserção em evento de fogo, o registro é classificado pela plataforma como foco prioritário para acompanhamento operacional. Essa classificação constitui um indicador de atenção e não, isoladamente, confirmação de incêndio florestal.`:'';
  const txt=`No âmbito do monitoramento de focos de calor, foi identificado registro no município de ${p.municipio||'não informado'}, ${p.estado||'unidade federativa não informada'}, em ${fmtDate(p.data_hora_local)}, pelo satélite ${p.satelite||'não informado'}${idade}. O foco apresenta índice de risco de fogo ${p.risco_fogo_enriquecido??'não disponível'}, enquadrado na classe ${p.classe_risco||'sem classificação'}, e Potência Radiativa do Fogo (PRF) de ${p.prf_mw??'valor não disponível'} MW, correspondente à classe ${p.classe_prf||'não informada'}. Quanto ao contexto ambiental, o ponto está associado à classe de uso e cobertura da terra ${p.uso_solo||p.classe_mapbiomas||'não informada'}, no bioma ${p.bioma||'não informado'}, e apresenta condição de relevo ${p.classe_relevo||'não informada'}.${evento}${territorial} ${contexto}${prioridade}`;
  $('drawerContent').innerHTML=`<h2>Ficha do foco</h2>${isPriority(p)?'<div class="priority-banner">⚠ Foco prioritário: risco Alto/Crítico + PRF ≥ 200 MW + associação a evento de fogo.</div>':''}<div class="detail-grid">${items.map(x=>`<div class="detail"><b>${x[0]}</b>${x[1]??'—'}</div>`).join('')}</div><section class="report-text"><h3>Análise técnica do registro</h3><p>${txt}</p><small>Texto gerado automaticamente a partir dos atributos disponíveis na base operacional da plataforma. Recomenda-se validação técnica antes de sua incorporação em documento oficial.</small></section>`;
  $('drawer').classList.add('open');
}
function analytics(){
  const a=S.filtered;
  const re=riskChartEntries(a);
  chart('riskChart','bar',re,{colors:re.map(x=>RISK_COLORS[normalize(x[0])]||'#7b8794')});
  const be=topEntries(countBy(a,f=>focusProps(f).bioma),10);
  chart('biomeChart','doughnut',be,{colors:be.map(x=>biomeColor(x[0])),legend:true});
  chart('useChart','bar',topEntries(countBy(a,f=>focusProps(f).uso_solo||focusProps(f).classe_mapbiomas),10));
  const se=topEntries(countBy(a,f=>satGroup(focusProps(f).satelite)),2);
  chart('satChart','bar',se,{colors:['#546e7a','#90a4ae']});
  const hours={};
  a.forEach(f=>{
    const d=new Date(focusProps(f).data_hora_local||focusProps(f).data_hora_utc);
    if(!isNaN(d)){const k=String(d.getHours()).padStart(2,'0')+'h';hours[k]=(hours[k]||0)+1}
  });
  chart('temporalChart','line',Object.entries(hours).sort((a,b)=>a[0].localeCompare(b[0])));
  if(S.env==='maranhao')chart('reliefChart','bar',topEntries(countBy(a,f=>focusProps(f).classe_relevo),10))
}

const REG={AC:'Norte',AP:'Norte',AM:'Norte',PA:'Norte',RO:'Norte',RR:'Norte',TO:'Norte',AL:'Nordeste',BA:'Nordeste',CE:'Nordeste',MA:'Nordeste',PB:'Nordeste',PE:'Nordeste',PI:'Nordeste',RN:'Nordeste',SE:'Nordeste',DF:'Centro-Oeste',GO:'Centro-Oeste',MT:'Centro-Oeste',MS:'Centro-Oeste',ES:'Sudeste',MG:'Sudeste',RJ:'Sudeste',SP:'Sudeste',PR:'Sul',RS:'Sul',SC:'Sul'};
const UF={'ACRE':'AC','ALAGOAS':'AL','AMAPA':'AP','AMAZONAS':'AM','BAHIA':'BA','CEARA':'CE','DISTRITO FEDERAL':'DF','ESPIRITO SANTO':'ES','GOIAS':'GO','MARANHAO':'MA','MATO GROSSO':'MT','MATO GROSSO DO SUL':'MS','MINAS GERAIS':'MG','PARA':'PA','PARAIBA':'PB','PARANA':'PR','PERNAMBUCO':'PE','PIAUI':'PI','RIO DE JANEIRO':'RJ','RIO GRANDE DO NORTE':'RN','RIO GRANDE DO SUL':'RS','RONDONIA':'RO','RORAIMA':'RR','SANTA CATARINA':'SC','SAO PAULO':'SP','SERGIPE':'SE','TOCANTINS':'TO'};

function comparisons(){
  if(S.env!=='brasil')return;
  const a=S.filtered;
  chart('stateChart','bar',topEntries(countBy(a,f=>focusProps(f).estado),10));
  chart('munChart','bar',topEntries(countBy(a,f=>focusProps(f).municipio),10));
  chart('regionChart','bar',topEntries(countBy(a,f=>REG[UF[normalize(focusProps(f).estado)]]||'Sem região'),5))
}

function protectedTables(){
  const a=S.filtered;
  const table=(obj)=>`<table><thead><tr><th>Área</th><th>Focos</th></tr></thead><tbody>${topEntries(obj,20).map(x=>`<tr><td>${x[0]}</td><td>${nf.format(x[1])}</td></tr>`).join('')}</tbody></table>`;
  if($('ucTable'))$('ucTable').innerHTML=table(countBy(a.filter(f=>focusProps(f).em_unidade_conservacao),f=>focusProps(f).unidade_conservacao_nome));
  if($('tiTable'))$('tiTable').innerHTML=table(countBy(a.filter(f=>focusProps(f).em_terra_indigena),f=>focusProps(f).terra_indigena_nome))
}

function events(){
  const ev={};
  S.filtered.filter(f=>focusProps(f).dentro_evento_fogo).forEach(f=>{
    const p=focusProps(f),id=p.id_evento_fogo||'Evento sem ID';
    if(!ev[id])ev[id]={n:0,status:p.status_evento_fogo,tipo:p.tipo_evento_fogo};
    ev[id].n++
  });
  if($('events'))$('events').innerHTML=Object.entries(ev).sort((a,b)=>b[1].n-a[1].n).slice(0,12).map(([id,x])=>`<div class="event"><b>${id}</b><small>${x.tipo||'Evento de fogo'}</small><strong>${nf.format(x.n)} focos</strong><small>${x.status||'—'}</small></div>`).join('')||'<small>Nenhum foco do recorte está associado a evento.</small>'
}

function renderAll(){
  cards();
  renderFocos();
  analytics();
  comparisons();
  if(S.env==='maranhao')protectedTables();
  events();
  if($('choroOn')?.checked)drawChoropleth()
}

async function loadGeo(key){
  if(S.geo[key])return S.geo[key];
  const r=await fetch(PATH[key]);
  if(!r.ok)throw new Error(`${PATH[key]}: ${r.status}`);
  S.geo[key]=await r.json();
  return S.geo[key]
}

async function toggleGeo(key,on,style,nameType){
  if(S.layers[key]){
    if(on){S.layers[key].addTo(S.map);bringFocosForward()}else S.map.removeLayer(S.layers[key]);
    return
  }
  if(!on)return;
  try{
    const g=await loadGeo(key);
    S.layers[key]=L.geoJSON(g,{pane:'dadosTerritoriais',interactive:false,style,onEachFeature:(f,l)=>{const n=propName(featureProps(f),nameType);l.bindTooltip(n,{sticky:true,className:'territory-label'})}}).addTo(S.map);bringFocosForward()
  }catch(e){
    alert('Não foi possível carregar '+PATH[key]+'\n'+e.message)
  }
}

async function drawChoropleth(){
  try{
    const g=await loadGeo('mun');
    if(S.layers.choro)S.map.removeLayer(S.layers.choro);
    const counts=countBy(S.filtered,f=>normalize(focusProps(f).municipio));
    S.layers.choro=L.geoJSON(g,{
      pane:'dadosTerritoriais',interactive:false,
      style:f=>{
        const n=counts[normalize(propName(featureProps(f),'mun'))]||0;
        const c=n>50?'#a50f15':n>20?'#de2d26':n>10?'#fb6a4a':n>5?'#fcae91':n>0?'#fdd0c2':'#fff5f0';
        return{color:'#fff',weight:1,fillColor:c,fillOpacity:.72}
      },
      onEachFeature:(f,l)=>{
        const name=propName(featureProps(f),'mun'),n=counts[normalize(name)]||0;
        l.bindTooltip(`${name}: ${nf.format(n)} focos`,{sticky:true})
      }
    });
    if($('choroOn')?.checked){S.layers.choro.addTo(S.map);bringFocosForward()}
  }catch(e){alert('Erro na malha municipal: '+e.message)}
}

async function territoryOptions(type){
  const sel=$('territorioNome');
  if(!sel)return;
  sel.disabled=true;
  sel.innerHTML='<option>Carregando...</option>';
  try{
    let names=[];
    if(type==='ti'){
      const g=await loadGeo('ti');
      names=unique(g.features.map(f=>propName(featureProps(f),'ti')))
    }else if(type==='uc'){
      const [a,b]=await Promise.all([loadGeo('ucEst'),loadGeo('ucFed')]);
      names=unique([...a.features,...b.features].map(f=>propName(featureProps(f),'uc')))
    }else if(type==='municipio'){
      const g=await loadGeo('mun');
      names=unique(g.features.map(f=>propName(featureProps(f),'mun')))
    }
    sel.innerHTML='<option value="">Selecione...</option>'+names.map(n=>`<option>${n}</option>`).join('');
    sel.disabled=!type
  }catch(e){
    sel.innerHTML='<option>Erro ao carregar</option>';
    alert(e.message)
  }
}

async function selectTerritory(){
  const type=$('territorioTipo')?.value||'',name=$('territorioNome')?.value||'';
  S.layers.territoryHighlight.clearLayers();
  if(!type||!name){S.territory=null;applyFilters();return}
  let features=[];
  if(type==='municipio')features=(await loadGeo('mun')).features.filter(f=>normalize(propName(featureProps(f),'mun'))===normalize(name));
  if(type==='ti')features=(await loadGeo('ti')).features.filter(f=>normalize(propName(featureProps(f),'ti'))===normalize(name));
  if(type==='uc'){
    const [a,b]=await Promise.all([loadGeo('ucEst'),loadGeo('ucFed')]);
    features=[...a.features,...b.features].filter(f=>normalize(propName(featureProps(f),'uc'))===normalize(name))
  }
  S.territory={type,name};
  S.layers.territoryHighlight.addData({type:'FeatureCollection',features});
  if(features.length){
    const b=S.layers.territoryHighlight.getBounds();
    if(b.isValid())S.map.fitBounds(b,{padding:[20,20]})
  }
  applyFilters()
}

function setEnv(env){
  S.env=env;
  document.querySelectorAll('[data-env]').forEach(b=>b.classList.toggle('active',b.dataset.env===env));
  const ma=env==='maranhao';
  $('maLayerMenu')?.classList.toggle('hidden',!ma);
  $('territorialFilter')?.classList.toggle('hidden',!ma);
  $('protectedPanel')?.classList.toggle('hidden',!ma);
  $('reliefPanel')?.classList.toggle('hidden',!ma);
  $('brCompare')?.classList.toggle('hidden',ma);
  if($('estado')){$('estado').disabled=ma;if(ma)$('estado').value=''}
  if(ma)S.map.setView([-5.3,-45.2],6);else S.map.setView([-14.2,-51.9],4);
  refreshMunicipios();
  applyFilters()
}

async function toggleEventLayer(kind,on){
  const key=kind==='active'?'eventActive':'eventObs', id=kind==='active'?'eventActiveOn':'eventObsOn';
  if(S.layers[key]){if(on){S.layers[key].addTo(S.map);bringFocosForward()}else S.map.removeLayer(S.layers[key]);return}
  if(!on)return;
  const status=$('eventLayerStatus');
  if(status)status.textContent='Eventos: carregando camada...';
  try{
    const g=await loadGeo(key);
    const active=kind==='active';
    S.layers[key]=L.geoJSON(g,{
      pane:'dadosTerritoriais',filter:f=>{const p=featureProps(f);return normalize(val(p,'estados','estado','UF','uf')||'').includes('MARANHAO') || /(^|[,;\s])MA([,;\s]|$)/.test(normalize(val(p,'estados','estado','UF','uf')||''))},
      interactive:false,
      style:{color:active?'#c62828':'#ef6c00',weight:2,dashArray:active?null:'7,5',fillColor:active?'#ef5350':'#ffb74d',fillOpacity:.10},
      onEachFeature:(f,l)=>{
        const p=featureProps(f);
        const eid=val(p,'id_evento','ID_EVENTO','id','ID')||'Evento de fogo';
        const area=val(p,'area_ha','AREA_HA','eaq_ha','EAQ');
        const dur=val(p,'duracao','DURACAO','duracao_dias');
        l.bindPopup(`<b>${active?'Evento ativo':'Evento em observação'}</b><br><b>ID:</b> ${eid}${area!=null?`<br><b>Área estimada:</b> ${area} ha`:''}${dur!=null?`<br><b>Duração:</b> ${dur}`:''}`)
      }
    }).addTo(S.map);bringFocosForward();
    if(status)status.textContent='Eventos: camada carregada'
  }catch(e){
    if($(id))$(id).checked=false;
    if(status)status.textContent='Eventos: GeoJSON ainda não publicado em web/data';
    alert('A interface está pronta, mas falta o arquivo '+PATH[key]+' no GitHub.\n\nPublique a cópia GeoJSON dos Eventos de Fogo para ativar esta camada.')
  }
}

function exportCsv(){
  const cols=['id_foco','data_hora_local','idade_foco_horas','satelite','estado','municipio','bioma','classe_risco','risco_fogo_enriquecido','prf_mw','classe_prf','uso_solo','classe_mapbiomas','dentro_evento_fogo','id_evento_fogo','status_evento_fogo','elevacao_m','declividade_graus','classe_relevo','terra_indigena_nome','unidade_conservacao_nome','rodovia_mais_proxima','distancia_rodovia_m','linha_energia_mais_proxima','distancia_linha_energia_m'];
  const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[cols.join(';'),...S.filtered.map(f=>{const p=focusProps(f);return cols.map(c=>q(p[c])).join(';')})];
  const blob=new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`focos_${S.env}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href)
}

function wire(){
  document.querySelectorAll('[data-env]').forEach(b=>b.onclick=()=>setEnv(b.dataset.env));
  ['estado','municipio','risco','bioma','prf','satelite','recencia'].forEach(id=>{
    const el=$(id);if(el)el.onchange=()=>{if(id==='estado')refreshMunicipios();applyFilters()}
  });
  if($('clear'))$('clear').onclick=()=>{
    ['estado','municipio','risco','bioma','prf','satelite','recencia'].forEach(id=>{if($(id))$(id).value=''});
    S.territory=null;
    if($('territorioTipo'))$('territorioTipo').value='';
    if($('territorioNome')){$('territorioNome').innerHTML='<option value="">Selecione o tipo</option>';$('territorioNome').disabled=true}
    S.layers.territoryHighlight.clearLayers();
    refreshMunicipios();
    applyFilters()
  };
  if($('focosOn'))$('focosOn').onchange=e=>{if(e.target.checked){S.layers.focos.addTo(S.map);bringFocosForward()}else S.map.removeLayer(S.layers.focos)};
  if($('kernelOn'))$('kernelOn').onchange=renderHeat;
  if($('eventActiveOn'))$('eventActiveOn').onchange=e=>toggleEventLayer('active',e.target.checked);
  if($('eventObsOn'))$('eventObsOn').onchange=e=>toggleEventLayer('obs',e.target.checked);
  if($('hillshadeOn'))$('hillshadeOn').onchange=e=>e.target.checked?S.layers.hillshade.addTo(S.map):S.map.removeLayer(S.layers.hillshade);
  if($('exportCsv'))$('exportCsv').onclick=exportCsv;
  if($('municipiosOn'))$('municipiosOn').onchange=e=>toggleGeo('mun',e.target.checked,{color:'#555',weight:1,fillOpacity:0},'mun');
  if($('tiOn'))$('tiOn').onchange=e=>toggleGeo('ti',e.target.checked,{color:'#7b4ca5',weight:2,fillOpacity:.07},'ti');
  if($('ucEstOn'))$('ucEstOn').onchange=e=>toggleGeo('ucEst',e.target.checked,{color:'#e0aa2f',weight:2,dashArray:'6,4',fillOpacity:.04},'uc');
  if($('ucFedOn'))$('ucFedOn').onchange=e=>toggleGeo('ucFed',e.target.checked,{color:'#2b8a5a',weight:2,dashArray:'6,4',fillOpacity:.04},'uc');
  if($('roadsOn'))$('roadsOn').onchange=e=>toggleGeo('road',e.target.checked,{color:'#c0392b',weight:2,opacity:.8},'road');
  if($('energyOn'))$('energyOn').onchange=e=>toggleGeo('energy',e.target.checked,{color:'#7a5c00',weight:2,opacity:.8,dashArray:'4,3'},'other');
  if($('choroOn'))$('choroOn').onchange=e=>e.target.checked?drawChoropleth():S.layers.choro&&S.map.removeLayer(S.layers.choro);
  document.querySelectorAll('input[name=base]').forEach(r=>r.onchange=e=>{
    Object.values(S.base).forEach(l=>S.map.removeLayer(l));
    S.base[e.target.value].addTo(S.map);
    S.base[e.target.value].bringToBack()
  });
  if($('territorioTipo'))$('territorioTipo').onchange=e=>{
    S.territory=null;
    S.layers.territoryHighlight.clearLayers();
    territoryOptions(e.target.value);
    applyFilters()
  };
  if($('territorioNome'))$('territorioNome').onchange=selectTerritory;
  if($('clearTerritory'))$('clearTerritory').onclick=()=>{
    $('territorioTipo').value='';
    $('territorioNome').innerHTML='<option value="">Selecione o tipo</option>';
    $('territorioNome').disabled=true;
    S.territory=null;
    S.layers.territoryHighlight.clearLayers();
    applyFilters()
  };
  if($('closeDrawer'))$('closeDrawer').onclick=()=>$('drawer').classList.remove('open')
}

async function boot(){
  try{
    initMap();
    wire();
    const [status,geo]=await Promise.all([
      fetch('data/status.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('status.json: '+r.status);return r.json()}),
      fetch('data/focos_24h.geojson',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('focos_24h.geojson: '+r.status);return r.json()})
    ]);
    S.status=status;
    S.all=geo.features||[];
    if($('updated'))$('updated').textContent='Última atualização do banco: '+new Date(status.ultima_atualizacao_banco||status.gerado_em).toLocaleString('pt-BR');
    if($('statusBadge'))$('statusBadge').textContent='● '+(status.status||'Atualizado');
    setupFilters();
    setEnv('maranhao')
  }catch(e){
    console.error(e);
    alert('Erro ao carregar a plataforma: '+e.message)
  }finally{
    $('loading')?.classList.add('hidden')
  }
}
boot();
